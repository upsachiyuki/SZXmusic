use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSourceStream, ReadOnlySource};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PlayerError {
    #[error("B站 API 错误: {0}")]
    Bili(#[from] bili_api::BiliError),
    #[error("拉流 HTTP 错误: {0}")]
    Http(#[from] reqwest::Error),
    #[error("音频容器/解码错误: {0}")]
    Decode(String),
    #[error("音频输出设备不可用: {0}")]
    AudioDevice(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct DecodeVerifySummary {
    pub codec: String,
    pub sample_rate: u32,
    pub channels: usize,
    pub frames_decoded: usize,
    pub samples_decoded: usize,
    pub peak_rms: f32,
    pub duration_sec: f64,
    pub sample_spectrum: Vec<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TelemetryPayload {
    pub spectrum: Vec<f32>,
    #[serde(rename = "levelL")]
    pub level_l: f32,
    #[serde(rename = "levelR")]
    pub level_r: f32,
    #[serde(rename = "positionSec")]
    pub position_sec: f64,
    #[serde(rename = "isPlaying")]
    pub is_playing: bool,
    #[serde(rename = "liveStreamActive")]
    pub live_stream_active: bool,
    #[serde(rename = "streamStatus")]
    pub stream_status: String,
    pub bpm: u32,
    #[serde(rename = "musicalKey")]
    pub musical_key: String,
    pub energy: u8,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioQualityOption {
    pub id: u32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BiliPlaySummary {
    pub bvid: String,
    pub cid: u64,
    pub page: u32,
    pub pages: Vec<bili_api::VideoPage>,
    pub title: String,
    pub owner: String,
    pub cover_url: String,
    pub codec: String,
    pub sample_rate: u32,
    pub channels: usize,
    pub duration_sec: f64,
    pub quality_id: u32,
    pub quality_label: String,
    pub available_qualities: Vec<AudioQualityOption>,
    pub from_cache: bool,
    pub bpm: u32,
    pub musical_key: String,
    pub energy: u8,
}

/// Fetches up to `max_bytes` from a Bilibili DASH stream URL (with mandatory Referer)
/// or the full stream when `max_bytes` is `None`.
pub async fn download_stream_bytes(
    http: &reqwest::Client,
    url: &str,
    max_bytes: Option<usize>,
) -> Result<Vec<u8>, PlayerError> {
    let mut req = http
        .get(url)
        .header("Referer", "https://www.bilibili.com/")
        .header("Origin", "https://www.bilibili.com");

    if let Some(limit) = max_bytes {
        req = req.header("Range", format!("bytes=0-{}", limit.saturating_sub(1)));
    }

    let resp = req.send().await?.error_for_status()?;
    let bytes = resp.bytes().await?;
    Ok(bytes.to_vec())
}

/// Decodes raw fMP4/AAC/FLAC/MP3 audio bytes via symphonia into stereo interleaved f32 PCM
/// and returns verification telemetry including a 28-band FFT snapshot.
/// When `seekable` is `false`, wraps the stream in `ReadOnlySource` so truncated Range prefixes
/// probe and decode progressively without failing on trailing truncated atoms.
pub fn decode_audio_bytes_with_mode(
    bytes: Vec<u8>,
    ext_hint: Option<&str>,
    max_frames: Option<usize>,
    seekable: bool,
) -> Result<(DecodeVerifySummary, Vec<f32>), PlayerError> {
    let cursor = Cursor::new(bytes);
    let mss = if seekable {
        MediaSourceStream::new(Box::new(cursor), Default::default())
    } else {
        MediaSourceStream::new(Box::new(ReadOnlySource::new(cursor)), Default::default())
    };

    let mut hint = Hint::new();
    if let Some(ext) = ext_hint {
        hint.with_extension(ext);
    }

    let format_opts = FormatOptions {
        enable_gapless: true,
        ..Default::default()
    };
    let metadata_opts = MetadataOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| PlayerError::Decode(format!("probe failed: {e}")))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| PlayerError::Decode("no decodable audio track found".into()))?;

    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map(|c| c.count()).unwrap_or(2).max(1);
    let codec_name = match codec_params.codec {
        symphonia::core::codecs::CODEC_TYPE_AAC => "AAC".to_string(),
        symphonia::core::codecs::CODEC_TYPE_FLAC => "FLAC".to_string(),
        symphonia::core::codecs::CODEC_TYPE_MP3 => "MP3".to_string(),
        symphonia::core::codecs::CODEC_TYPE_VORBIS => "VORBIS".to_string(),
        symphonia::core::codecs::CODEC_TYPE_ALAC => "ALAC".to_string(),
        _ => "PCM".to_string(),
    };

    let n_frames_hint = codec_params.n_frames.unwrap_or(0);
    let duration_sec = if n_frames_hint > 0 && sample_rate > 0 {
        n_frames_hint as f64 / sample_rate as f64
    } else {
        0.0
    };

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| PlayerError::Decode(format!("codec init failed: {e}")))?;

    let mut pcm_stereo = Vec::new();
    let mut frames_decoded = 0usize;
    let mut peak_rms = 0.0f32;
    let mut last_fft_window = Vec::new();

    loop {
        if let Some(limit) = max_frames {
            if frames_decoded >= limit {
                break;
            }
        }

        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(err) => {
                // Range-truncated prefix downloads naturally end mid-segment after yielding frames.
                if frames_decoded > 0 {
                    break;
                }
                return Err(PlayerError::Decode(format!("next_packet failed: {err}")));
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => {
                if frames_decoded > 0 {
                    break;
                }
                return Err(PlayerError::Decode(format!("decode error: {err}")));
            }
        };

        let spec = *decoded.spec();
        let ch_count = spec.channels.count().max(1);
        let mut sbuf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sbuf.copy_interleaved_ref(decoded);
        let samples = sbuf.samples();
        if samples.is_empty() {
            continue;
        }

        frames_decoded += 1;

        let mut sq_sum = 0.0f32;
        for frame in samples.chunks(ch_count) {
            let l = frame[0];
            let r = if ch_count > 1 { frame[1] } else { frame[0] };
            pcm_stereo.push(l);
            pcm_stereo.push(r);
            let mono = 0.5 * (l + r);
            sq_sum += mono * mono;
            if last_fft_window.len() < 1024 {
                last_fft_window.push(mono);
            }
        }
        let rms = (sq_sum / (samples.len() / ch_count).max(1) as f32).sqrt();
        if rms > peak_rms {
            peak_rms = rms;
        }
    }

    if frames_decoded == 0 {
        return Err(PlayerError::Decode("decoded 0 audio frames".into()));
    }

    let computed_dur = if duration_sec > 0.0 {
        duration_sec
    } else {
        (pcm_stereo.len() / 2) as f64 / sample_rate as f64
    };

    let spectrum = compute_spectrum_28(&last_fft_window);

    Ok((
        DecodeVerifySummary {
            codec: codec_name,
            sample_rate,
            channels,
            frames_decoded,
            samples_decoded: pcm_stereo.len() / 2,
            peak_rms,
            duration_sec: computed_dur,
            sample_spectrum: spectrum,
        },
        pcm_stereo,
    ))
}

pub fn decode_audio_bytes(
    bytes: Vec<u8>,
    ext_hint: Option<&str>,
    max_frames: Option<usize>,
) -> Result<(DecodeVerifySummary, Vec<f32>), PlayerError> {
    decode_audio_bytes_with_mode(bytes, ext_hint, max_frames, true)
}

/// Decodes audio directly into compact 16-bit interleaved stereo PCM (`i16`) with reusable
/// decode buffers and capacity pre-reservation so peak decoding RAM stays ~50-66% smaller.
pub fn decode_audio_bytes_i16(
    bytes: Vec<u8>,
    ext_hint: Option<&str>,
) -> Result<(DecodeVerifySummary, Vec<i16>), PlayerError> {
    let cursor = Cursor::new(bytes);
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = ext_hint {
        hint.with_extension(ext);
    }

    let format_opts = FormatOptions {
        enable_gapless: true,
        ..Default::default()
    };
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &MetadataOptions::default())
        .map_err(|e| PlayerError::Decode(format!("probe failed: {e}")))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| PlayerError::Decode("no decodable audio track found".into()))?;

    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map(|c| c.count()).unwrap_or(2).max(1);
    let codec_name = match codec_params.codec {
        symphonia::core::codecs::CODEC_TYPE_AAC => "AAC".to_string(),
        symphonia::core::codecs::CODEC_TYPE_FLAC => "FLAC".to_string(),
        symphonia::core::codecs::CODEC_TYPE_MP3 => "MP3".to_string(),
        symphonia::core::codecs::CODEC_TYPE_VORBIS => "VORBIS".to_string(),
        symphonia::core::codecs::CODEC_TYPE_ALAC => "ALAC".to_string(),
        _ => "PCM".to_string(),
    };

    let n_frames_hint = codec_params.n_frames.unwrap_or(0);
    let duration_sec = if n_frames_hint > 0 && sample_rate > 0 {
        n_frames_hint as f64 / sample_rate as f64
    } else {
        0.0
    };

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| PlayerError::Decode(format!("codec init failed: {e}")))?;

    // Cap pre-allocation to at most 15 minutes @ sr (~172 MB i16) to stay safe against bogus metadata headers.
    let reserve_frames = (n_frames_hint as usize).min((sample_rate as usize) * 900);
    let mut pcm_stereo: Vec<i16> = if reserve_frames > 0 {
        Vec::with_capacity(reserve_frames.saturating_mul(2))
    } else {
        Vec::new()
    };
    let mut frames_decoded = 0usize;
    let mut peak_rms = 0.0f32;
    let mut last_fft_window = Vec::with_capacity(1024);
    let mut scratch_sbuf: Option<(u64, symphonia::core::audio::SignalSpec, SampleBuffer<i16>)> = None;
    const INV_I16: f32 = 1.0 / (i16::MAX as f32);

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(err) => {
                if frames_decoded > 0 {
                    break;
                }
                return Err(PlayerError::Decode(format!("next_packet failed: {err}")));
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(err) => {
                if frames_decoded > 0 {
                    break;
                }
                return Err(PlayerError::Decode(format!("decode error: {err}")));
            }
        };

        let spec = *decoded.spec();
        let ch_count = spec.channels.count().max(1);
        let needed_cap = decoded.capacity() as u64;
        let reuse_ok = scratch_sbuf
            .as_ref()
            .is_some_and(|(cap, prev_spec, _)| *cap >= needed_cap && *prev_spec == spec);
        if !reuse_ok {
            scratch_sbuf = Some((needed_cap, spec, SampleBuffer::<i16>::new(needed_cap, spec)));
        }
        let sbuf = &mut scratch_sbuf.as_mut().unwrap().2;
        sbuf.copy_interleaved_ref(decoded);
        let samples = sbuf.samples();
        if samples.is_empty() {
            continue;
        }

        frames_decoded += 1;

        let mut sq_sum = 0.0f32;
        for frame in samples.chunks(ch_count) {
            let l = frame[0];
            let r = if ch_count > 1 { frame[1] } else { frame[0] };
            pcm_stereo.push(l);
            pcm_stereo.push(r);
            let mono = 0.5 * ((l as f32 + r as f32) * INV_I16);
            sq_sum += mono * mono;
            if last_fft_window.len() < 1024 {
                last_fft_window.push(mono);
            }
        }
        let rms = (sq_sum / (samples.len() / ch_count).max(1) as f32).sqrt();
        if rms > peak_rms {
            peak_rms = rms;
        }
    }

    if frames_decoded == 0 {
        return Err(PlayerError::Decode("decoded 0 audio frames".into()));
    }

    pcm_stereo.shrink_to_fit();
    let computed_dur = if duration_sec > 0.0 {
        duration_sec
    } else {
        (pcm_stereo.len() / 2) as f64 / sample_rate as f64
    };
    let spectrum = compute_spectrum_28(&last_fft_window);

    Ok((
        DecodeVerifySummary {
            codec: codec_name,
            sample_rate,
            channels,
            frames_decoded,
            samples_decoded: pcm_stereo.len() / 2,
            peak_rms,
            duration_sec: computed_dur,
            sample_spectrum: spectrum,
        },
        pcm_stereo,
    ))
}

pub fn compute_spectrum_28(mono_samples: &[f32]) -> Vec<f32> {
    const N: usize = 512;
    const BANDS: usize = 28;
    if mono_samples.is_empty() {
        return vec![0.05; BANDS];
    }

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(N);
    let mut buffer = vec![Complex::new(0.0, 0.0); N];

    let start = mono_samples.len().saturating_sub(N);
    for (i, sample) in mono_samples[start..].iter().take(N).enumerate() {
        let hann = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (N as f32 - 1.0)).cos());
        buffer[i] = Complex::new(sample * hann, 0.0);
    }

    fft.process(&mut buffer);

    let max_bin = N / 2;
    let mut out = Vec::with_capacity(BANDS);
    for b in 0..BANDS {
        let lo = ((b as f32 / BANDS as f32).powf(1.55) * (max_bin as f32 - 2.0)) as usize + 1;
        let hi = (((b + 1) as f32 / BANDS as f32).powf(1.55) * (max_bin as f32 - 2.0)) as usize + 2;
        let hi = hi.max(lo + 1).min(max_bin);
        let sum: f32 = buffer[lo..hi].iter().map(|c| c.norm()).sum();
        let avg = sum / (hi - lo) as f32;
        let scaled = ((avg / 18.0).ln_1p() * 0.45).clamp(0.05, 0.98);
        out.push(scaled);
    }
    out
}

/// Computes acoustic BPM, Musical Key, and Energy (1..=5) from decoded stereo PCM samples.
pub fn analyze_audio_features(pcm_stereo: &[f32], sample_rate: u32) -> (u32, String, u8) {
    let total_frames = pcm_stereo.len() / 2;
    analyze_audio_features_with(total_frames, sample_rate, |frame_idx| {
        let base = frame_idx * 2;
        0.5 * (pcm_stereo[base] + pcm_stereo.get(base + 1).copied().unwrap_or(pcm_stereo[base]))
    })
}

/// Computes acoustic BPM, Musical Key, and Energy (1..=5) directly from compact `i16` PCM samples.
pub fn analyze_audio_features_i16(pcm_stereo: &[i16], sample_rate: u32) -> (u32, String, u8) {
    const INV_I16: f32 = 1.0 / (i16::MAX as f32);
    let total_frames = pcm_stereo.len() / 2;
    analyze_audio_features_with(total_frames, sample_rate, |frame_idx| {
        let base = frame_idx * 2;
        let l = pcm_stereo[base] as f32 * INV_I16;
        let r = pcm_stereo.get(base + 1).copied().unwrap_or(pcm_stereo[base]) as f32 * INV_I16;
        0.5 * (l + r)
    })
}

fn analyze_audio_features_with(
    total_frames: usize,
    sample_rate: u32,
    mono_at: impl Fn(usize) -> f32,
) -> (u32, String, u8) {
    let sr = sample_rate.max(8000) as usize;
    if total_frames < sr {
        return (108, "C major".to_string(), 3);
    }

    // Analyze a representative 24-second slice starting at 15% into the track
    let start_frame = (total_frames / 7).min(total_frames.saturating_sub(sr));
    let window_frames = (sr * 24).min(total_frames.saturating_sub(start_frame));
    let hop = (sr / 50).max(1); // 20 ms hop (50 Hz envelope)
    let mut env = Vec::with_capacity(window_frames / hop + 1);
    let mut total_sq = 0.0f64;

    for chunk_idx in 0..(window_frames / hop) {
        let f_start = start_frame + chunk_idx * hop;
        let f_end = (f_start + hop).min(total_frames);
        let mut sq = 0.0f32;
        let mut count = 0usize;
        for f in f_start..f_end {
            let m = mono_at(f);
            sq += m * m;
            count += 1;
        }
        let rms = (sq / count.max(1) as f32).sqrt();
        total_sq += (rms as f64) * (rms as f64);
        env.push(rms);
    }

    // Half-wave rectified first-order difference (onset strength envelope)
    let mut onset = Vec::with_capacity(env.len());
    let mut prev = 0.0f32;
    for &v in &env {
        let diff = (v - prev).max(0.0);
        onset.push(diff);
        prev = v;
    }

    // Autocorrelation over 68..=164 BPM at 50 Hz envelope rate
    let env_rate = 50.0f32;
    let mut best_bpm = 112u32;
    let mut best_score = -1.0f32;
    for bpm_cand in 68..=164u32 {
        let lag = (env_rate * 60.0 / bpm_cand as f32).round() as usize;
        if lag == 0 || lag >= onset.len() / 2 {
            continue;
        }
        let mut sum = 0.0f32;
        for i in 0..(onset.len() - lag) {
            sum += onset[i] * onset[i + lag];
        }
        // Mild perceptual prior around 95-132 BPM to avoid half/double-tempo octave errors
        let prior = 1.0 - ((bpm_cand as f32 - 114.0).abs() / 160.0) * 0.18;
        let score = (sum / (onset.len() - lag).max(1) as f32) * prior;
        if score > best_score {
            best_score = score;
            best_bpm = bpm_cand;
        }
    }

    // 12-bin Pitch Class Profile (Chroma) from 2048-point FFT slices
    const FFT_N: usize = 2048;
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_N);
    let mut chroma = [0.0f32; 12];
    let slices = 8usize;
    let step_frames = (window_frames / slices.max(1)).max(FFT_N);

    for s in 0..slices {
        let f0 = start_frame + s * step_frames;
        if f0 + FFT_N >= total_frames {
            break;
        }
        let mut buf = vec![Complex::new(0.0, 0.0); FFT_N];
        for i in 0..FFT_N {
            let m = mono_at(f0 + i);
            let hann = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (FFT_N as f32 - 1.0)).cos());
            buf[i] = Complex::new(m * hann, 0.0);
        }
        fft.process(&mut buf);
        for bin in 2..(FFT_N / 2) {
            let freq = bin as f32 * (sr as f32) / (FFT_N as f32);
            if !(80.0..=1600.0).contains(&freq) {
                continue;
            }
            let midi = 69.0 + 12.0 * (freq / 440.0).log2();
            let pc = (midi.round() as isize).rem_euclid(12) as usize;
            chroma[pc] += buf[bin].norm();
        }
    }

    let major_names = [
        "C major", "Db major", "D major", "Eb major", "E major", "F major",
        "F# major", "G major", "Ab major", "A major", "Bb major", "B major",
    ];
    let minor_names = [
        "C minor", "C# minor", "D minor", "Eb minor", "E minor", "F minor",
        "F# minor", "G minor", "G# minor", "A minor", "Bb minor", "B minor",
    ];
    let maj_prof: [f32; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    let min_prof: [f32; 12] = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    let mut best_key = "C major".to_string();
    let mut best_key_score = -1.0f32;
    for root in 0..12 {
        let mut maj_s = 0.0f32;
        let mut min_s = 0.0f32;
        for i in 0..12 {
            maj_s += chroma[(root + i) % 12] * maj_prof[i];
            min_s += chroma[(root + i) % 12] * min_prof[i];
        }
        if maj_s > best_key_score {
            best_key_score = maj_s;
            best_key = major_names[root].to_string();
        }
        if min_s > best_key_score {
            best_key_score = min_s;
            best_key = minor_names[root].to_string();
        }
    }

    let mean_rms = (total_sq / env.len().max(1) as f64).sqrt() as f32;
    let energy = if mean_rms > 0.24 {
        5
    } else if mean_rms > 0.16 {
        4
    } else if mean_rms > 0.09 {
        3
    } else if mean_rms > 0.04 {
        2
    } else {
        1
    };

    (best_bpm, best_key, energy)
}

const MAX_DISK_CACHE_BYTES: u64 = 96 * 1024 * 1024; // 96 MB LRU cap to keep disk footprint minimal
const MAX_SINGLE_CACHE_FILE_BYTES: usize = 12 * 1024 * 1024; // Skip caching individual streams > 12 MB

/// Shared audio playback state for live Bilibili streams via CPAL/WASAPI.
/// Stores 16-bit signed stereo PCM (`i16`) to cut runtime memory usage by 50% vs `f32`.
pub struct AudioEngine {
    samples: Mutex<Arc<Vec<i16>>>,
    cursor_frame: Arc<AtomicU64>,
    total_frames: Arc<AtomicU64>,
    paused: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
    volume_bits: Arc<AtomicU32>,
    sample_rate: Arc<AtomicU32>,
    track_bpm: Arc<AtomicU32>,
    track_energy: Arc<AtomicU32>,
    track_key: Mutex<String>,
    stream_handle: Mutex<Option<SendStream>>,
}

#[allow(dead_code)]
struct SendStream(cpal::Stream);
// Safety: cpal::Stream on Windows WASAPI is managed solely for lifetime keep-alive and dropped on stop.
unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            samples: Mutex::new(Arc::new(Vec::new())),
            cursor_frame: Arc::new(AtomicU64::new(0)),
            total_frames: Arc::new(AtomicU64::new(0)),
            paused: Arc::new(AtomicBool::new(false)),
            active: Arc::new(AtomicBool::new(false)),
            ended: Arc::new(AtomicBool::new(false)),
            volume_bits: Arc::new(AtomicU32::new(0.8f32.to_bits())),
            sample_rate: Arc::new(AtomicU32::new(48000)),
            track_bpm: Arc::new(AtomicU32::new(112)),
            track_energy: Arc::new(AtomicU32::new(3)),
            track_key: Mutex::new("C major".to_string()),
            stream_handle: Mutex::new(None),
        }
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    pub fn set_volume(&self, volume: f32) {
        let clamped = volume.clamp(0.0, 1.0);
        self.volume_bits.store(clamped.to_bits(), Ordering::Relaxed);
    }

    pub fn seek(&self, sec: f64) {
        let sr = self.sample_rate.load(Ordering::Relaxed) as f64;
        let total = self.total_frames.load(Ordering::Relaxed);
        if sr > 0.0 && total > 0 {
            let target = (sec.max(0.0) * sr).round() as u64;
            self.cursor_frame.store(target.min(total.saturating_sub(1)), Ordering::Relaxed);
            self.ended.store(false, Ordering::Relaxed);
        }
    }

    pub fn take_ended(&self) -> bool {
        let was_ended = self.ended.swap(false, Ordering::AcqRel);
        if was_ended {
            // Immediately release the finished track's PCM buffer & stream handle to free RAM
            if let Ok(mut guard) = self.stream_handle.lock() {
                *guard = None;
            }
            if let Ok(mut buf) = self.samples.lock() {
                *buf = Arc::new(Vec::new());
            }
        }
        was_ended
    }

    pub fn stop(&self) {
        self.active.store(false, Ordering::SeqCst);
        self.ended.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.stream_handle.lock() {
            *guard = None;
        }
        if let Ok(mut buf) = self.samples.lock() {
            *buf = Arc::new(Vec::new());
        }
        self.total_frames.store(0, Ordering::Relaxed);
        self.cursor_frame.store(0, Ordering::Relaxed);
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    pub fn telemetry_snapshot(&self, status: &str) -> TelemetryPayload {
        let sr = self.sample_rate.load(Ordering::Relaxed).max(1) as f64;
        let cur = self.cursor_frame.load(Ordering::Relaxed) as usize;
        let pos = cur as f64 / sr;
        let paused = self.paused.load(Ordering::Relaxed);

        let mut mono_window = Vec::with_capacity(512);
        let (mut l_peak, mut r_peak) = (0.04f32, 0.04f32);
        const INV_I16: f32 = 1.0 / (i16::MAX as f32);

        if let Ok(guard) = self.samples.lock() {
            let buf = &*guard;
            let start_sample = cur.saturating_mul(2);
            let end_sample = (start_sample + 1024).min(buf.len());
            if start_sample < end_sample {
                for pair in buf[start_sample..end_sample].chunks(2) {
                    let l = pair[0] as f32 * INV_I16;
                    let r = pair.get(1).copied().unwrap_or(pair[0]) as f32 * INV_I16;
                    l_peak = l_peak.max(l.abs());
                    r_peak = r_peak.max(r.abs());
                    mono_window.push(0.5 * (l + r));
                }
            }
        }

        let spectrum = if paused {
            vec![0.05; 28]
        } else {
            compute_spectrum_28(&mono_window)
        };

        let base_nrg = self.track_energy.load(Ordering::Relaxed).clamp(1, 5) as u8;
        let live_peak = 0.5 * (l_peak + r_peak);
        let live_energy = if paused {
            base_nrg
        } else if live_peak > 0.55 {
            5
        } else if live_peak > 0.34 {
            4.max(base_nrg)
        } else if live_peak > 0.16 {
            3.max(base_nrg.saturating_sub(1))
        } else if live_peak > 0.06 {
            2.max(base_nrg.saturating_sub(1))
        } else {
            base_nrg
        };

        TelemetryPayload {
            spectrum,
            level_l: if paused { 0.03 } else { l_peak.clamp(0.04, 0.98) },
            level_r: if paused { 0.03 } else { r_peak.clamp(0.04, 0.98) },
            position_sec: pos,
            is_playing: !paused,
            live_stream_active: self.active.load(Ordering::Relaxed),
            stream_status: status.to_string(),
            bpm: self.track_bpm.load(Ordering::Relaxed),
            musical_key: self
                .track_key
                .lock()
                .map(|g| g.clone())
                .unwrap_or_else(|_| "C major".to_string()),
            energy: live_energy,
        }
    }

    pub async fn play_bili_track(
        &self,
        shared_client: &Arc<tokio::sync::Mutex<bili_api::BiliClient>>,
        bvid: &str,
        cid_override: Option<u64>,
        preferred_quality: Option<u32>,
        cache_dir: Option<&Path>,
    ) -> Result<BiliPlaySummary, PlayerError> {
        self.stop();

        let (detail, target_cid, mut streams, http, cookie_hdr) = {
            let mut client = shared_client.lock().await;
            let detail = client.get_video_detail(bvid).await?;
            let target_cid = cid_override.filter(|&c| c > 0).unwrap_or(detail.cid);
            let streams = client
                .get_dash_audio_streams(&detail.bvid, target_cid)
                .await?;
            (
                detail,
                target_cid,
                streams,
                client.http().clone(),
                client.cookie_header(),
            )
        };

        let available_qualities: Vec<AudioQualityOption> = streams
            .iter()
            .map(|s| AudioQualityOption {
                id: s.id,
                label: s.quality_label.clone(),
            })
            .collect();

        if let Some(pref_id) = preferred_quality.filter(|&q| q > 0) {
            streams.sort_by_key(|s| {
                if s.id == pref_id {
                    0u32
                } else {
                    1u32 + s.id.abs_diff(pref_id)
                }
            });
        } else {
            // In "自动" (Auto) mode, prioritize 192K AAC (30280) / 132K AAC (30232) over 90MB+ Hi-Res FLAC (30251)
            // so runtime RAM and disk cache stay lightweight while preserving high audio fidelity.
            streams.sort_by_key(|s| match s.id {
                30280 => 0u32,
                30232 => 1u32,
                30216 => 2u32,
                30250 => 3u32,
                30251 => 4u32,
                _ => 5u32,
            });
        }

        let mut selected: Option<(bili_api::AudioStreamCandidate, Vec<u8>, bool)> = None;

        // 1. Check disk cache for the top-priority stream first (or fallback across streams if auto)
        if let Some(dir) = cache_dir {
            let check_slice = if preferred_quality.filter(|&q| q > 0).is_some() {
                &streams[..streams.len().min(1)]
            } else {
                &streams[..]
            };
            for cand in check_slice {
                let p = cache_file_path(dir, &detail.bvid, target_cid, cand.id);
                if let Ok(bytes) = std::fs::read(&p) {
                    if !bytes.is_empty() {
                        selected = Some((cand.clone(), bytes, true));
                        break;
                    }
                }
            }
        }

        // 2. Otherwise stream download from Bilibili CDN (falling back through qualities & backup URLs)
        if selected.is_none() {
            let mut last_err: Option<PlayerError> = None;
            'outer: for cand in &streams {
                let mut urls = Vec::with_capacity(1 + cand.backup_urls.len());
                urls.push(cand.base_url.as_str());
                for b in &cand.backup_urls {
                    urls.push(b.as_str());
                }
                for u in urls {
                    if u.is_empty() {
                        continue;
                    }
                    let mut req = http
                        .get(u)
                        .header("Referer", "https://www.bilibili.com/")
                        .header("Origin", "https://www.bilibili.com");
                    if let Some(c) = &cookie_hdr {
                        req = req.header("Cookie", c);
                    }
                    match req.send().await {
                        Ok(resp) if resp.status().is_success() => {
                            if let Ok(bytes) = resp.bytes().await {
                                let raw = bytes.to_vec();
                                if let Some(dir) = cache_dir {
                                    write_cache_with_lru(
                                        dir,
                                        &detail.bvid,
                                        target_cid,
                                        cand.id,
                                        &raw,
                                    );
                                }
                                selected = Some((cand.clone(), raw, false));
                                break 'outer;
                            }
                        }
                        Ok(resp) => {
                            last_err = Some(PlayerError::Decode(format!(
                                "音频流 CDN HTTP {}",
                                resp.status()
                            )));
                        }
                        Err(e) => {
                            last_err = Some(PlayerError::Http(e));
                        }
                    }
                }
            }
            if selected.is_none() {
                return Err(last_err.unwrap_or_else(|| {
                    PlayerError::Decode("所有 DASH 音频候选流下载失败".into())
                }));
            }
        }

        let (chosen, audio_bytes, from_cache) = selected.unwrap();
        let (summary, pcm_i16) = decode_audio_bytes_i16(audio_bytes, Some("m4a"))?;
        let (detected_bpm, detected_key, detected_energy) =
            analyze_audio_features_i16(&pcm_i16, summary.sample_rate);
        self.track_bpm.store(detected_bpm, Ordering::Relaxed);
        self.track_energy
            .store(detected_energy as u32, Ordering::Relaxed);
        if let Ok(mut kg) = self.track_key.lock() {
            *kg = detected_key.clone();
        }

        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| PlayerError::AudioDevice("default output device missing".into()))?;
        let supported = device
            .default_output_config()
            .map_err(|e| PlayerError::AudioDevice(e.to_string()))?;

        let out_sr = supported.sample_rate().0;
        let out_ch = supported.channels() as usize;

        let resampled = if summary.sample_rate == out_sr {
            pcm_i16
        } else {
            let mut r = resample_stereo_i16(&pcm_i16, summary.sample_rate, out_sr);
            drop(pcm_i16);
            r.shrink_to_fit();
            r
        };
        let frames_len = (resampled.len() / 2) as u64;
        let pcm_arc = Arc::new(resampled);
        if let Ok(mut buf) = self.samples.lock() {
            *buf = Arc::clone(&pcm_arc);
        }

        self.sample_rate.store(out_sr, Ordering::Relaxed);
        self.total_frames.store(frames_len, Ordering::Relaxed);
        self.cursor_frame.store(0, Ordering::Relaxed);
        self.ended.store(false, Ordering::SeqCst);
        self.paused.store(false, Ordering::Relaxed);
        self.active.store(true, Ordering::SeqCst);

        let paused = Arc::clone(&self.paused);
        let active = Arc::clone(&self.active);
        let ended = Arc::clone(&self.ended);
        let volume_bits = Arc::clone(&self.volume_bits);
        let cursor_frame = Arc::clone(&self.cursor_frame);

        let sample_format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();

        let build_f32_callback = move |out_ch: usize| {
            let paused = Arc::clone(&paused);
            let active = Arc::clone(&active);
            let ended = Arc::clone(&ended);
            let volume_bits = Arc::clone(&volume_bits);
            let cursor_frame = Arc::clone(&cursor_frame);
            let pcm_arc = Arc::clone(&pcm_arc);
            const INV_I16: f32 = 1.0 / (i16::MAX as f32);
            move |frame_out: &mut [f32]| {
                if paused.load(Ordering::Relaxed) || !active.load(Ordering::Relaxed) {
                    frame_out.fill(0.0);
                    return;
                }
                let vol = f32::from_bits(volume_bits.load(Ordering::Relaxed));
                let mut idx = cursor_frame.load(Ordering::Relaxed) as usize;
                let total = pcm_arc.len() / 2;

                for frame in frame_out.chunks_mut(out_ch.max(1)) {
                    if idx >= total {
                        frame.fill(0.0);
                        continue;
                    }
                    let l = pcm_arc.get(idx * 2).copied().unwrap_or(0) as f32 * INV_I16;
                    let r = pcm_arc.get(idx * 2 + 1).copied().unwrap_or(0) as f32 * INV_I16;
                    if out_ch >= 2 {
                        frame[0] = (l * vol).clamp(-1.0, 1.0);
                        frame[1] = (r * vol).clamp(-1.0, 1.0);
                        for extra in frame.iter_mut().skip(2) {
                            *extra = 0.0;
                        }
                    } else if !frame.is_empty() {
                        frame[0] = (0.5 * (l + r) * vol).clamp(-1.0, 1.0);
                    }
                    idx += 1;
                }
                cursor_frame.store(idx as u64, Ordering::Relaxed);
                if idx >= total {
                    active.store(false, Ordering::SeqCst);
                    ended.store(true, Ordering::SeqCst);
                }
            }
        };

        let stream = match sample_format {
            cpal::SampleFormat::I16 => {
                let cb = build_f32_callback(out_ch);
                let mut scratch = Vec::<f32>::new();
                device.build_output_stream(
                    &config,
                    move |data: &mut [i16], _| {
                        if scratch.len() != data.len() {
                            scratch.resize(data.len(), 0.0);
                        }
                        cb(&mut scratch);
                        for (dst, &src) in data.iter_mut().zip(scratch.iter()) {
                            *dst = (src * i16::MAX as f32) as i16;
                        }
                    },
                    |_err| {},
                    Some(Duration::from_millis(200)),
                )
            }
            cpal::SampleFormat::U16 => {
                let cb = build_f32_callback(out_ch);
                let mut scratch = Vec::<f32>::new();
                device.build_output_stream(
                    &config,
                    move |data: &mut [u16], _| {
                        if scratch.len() != data.len() {
                            scratch.resize(data.len(), 0.0);
                        }
                        cb(&mut scratch);
                        for (dst, &src) in data.iter_mut().zip(scratch.iter()) {
                            *dst = ((src * 0.5 + 0.5) * u16::MAX as f32) as u16;
                        }
                    },
                    |_err| {},
                    Some(Duration::from_millis(200)),
                )
            }
            _ => {
                let cb = build_f32_callback(out_ch);
                device.build_output_stream(
                    &config,
                    move |data: &mut [f32], _| cb(data),
                    |_err| {},
                    Some(Duration::from_millis(200)),
                )
            }
        }
        .map_err(|e| PlayerError::AudioDevice(e.to_string()))?;

        stream
            .play()
            .map_err(|e| PlayerError::AudioDevice(e.to_string()))?;

        if let Ok(mut guard) = self.stream_handle.lock() {
            *guard = Some(SendStream(stream));
        }

        let matched_page = detail.pages.iter().find(|p| p.cid == target_cid);
        let current_page = matched_page.map(|p| p.page).unwrap_or(1);
        let page_cover = matched_page
            .and_then(|p| p.first_frame.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| detail.pic.clone());

        let part_suffix = detail
            .pages
            .iter()
            .find(|p| p.cid == target_cid && p.page > 1)
            .map(|p| format!(" (P{})", p.page))
            .unwrap_or_default();

        Ok(BiliPlaySummary {
            bvid: detail.bvid,
            cid: target_cid,
            page: current_page,
            pages: detail.pages,
            title: format!("{}{}", detail.title, part_suffix),
            owner: detail.owner_name,
            cover_url: page_cover,
            codec: summary.codec,
            sample_rate: summary.sample_rate,
            channels: summary.channels,
            duration_sec: if summary.duration_sec > 0.0 {
                summary.duration_sec
            } else {
                detail.duration_sec as f64
            },
            quality_id: chosen.id,
            quality_label: chosen.quality_label,
            available_qualities,
            from_cache,
            bpm: detected_bpm,
            musical_key: detected_key,
            energy: detected_energy,
        })
    }
}

fn cache_file_path(dir: &Path, bvid: &str, cid: u64, qid: u32) -> PathBuf {
    dir.join(format!("{bvid}_{cid}_{qid}.m4a"))
}

pub fn prune_disk_cache(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, SystemTime)> = rd
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let len = meta.len();
            if len > MAX_SINGLE_CACHE_FILE_BYTES as u64 {
                let _ = std::fs::remove_file(e.path());
                return None;
            }
            let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            Some((e.path(), len, mtime))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total > MAX_DISK_CACHE_BYTES {
        files.sort_by_key(|f| f.2);
        for (p, sz, _) in files {
            if total <= MAX_DISK_CACHE_BYTES {
                break;
            }
            if std::fs::remove_file(p).is_ok() {
                total = total.saturating_sub(sz);
            }
        }
    }
}

fn write_cache_with_lru(dir: &Path, bvid: &str, cid: u64, qid: u32, bytes: &[u8]) {
    if bytes.len() > MAX_SINGLE_CACHE_FILE_BYTES {
        return;
    }
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let path = cache_file_path(dir, bvid, cid, qid);
    if std::fs::write(&path, bytes).is_err() {
        return;
    }
    prune_disk_cache(dir);
}

fn resample_stereo_i16(pcm_stereo: &[i16], src_sr: u32, dst_sr: u32) -> Vec<i16> {
    if pcm_stereo.is_empty() || src_sr == 0 || dst_sr == 0 {
        return Vec::new();
    }
    if src_sr == dst_sr {
        return pcm_stereo.to_vec();
    }
    let src_frames = pcm_stereo.len() / 2;
    let dst_frames = ((src_frames as f64) * (dst_sr as f64) / (src_sr as f64)).round() as usize;
    let mut out = Vec::with_capacity(dst_frames * 2);
    let ratio = src_sr as f64 / dst_sr as f64;
    let last_idx = src_frames.saturating_sub(1);
    for i in 0..dst_frames {
        let pos = i as f64 * ratio;
        let idx0 = (pos.floor() as usize).min(last_idx);
        let idx1 = (idx0 + 1).min(last_idx);
        let frac = (pos - idx0 as f64) as f32;
        let inv = 1.0 - frac;
        let l = (pcm_stereo[idx0 * 2] as f32 * inv + pcm_stereo[idx1 * 2] as f32 * frac)
            .round()
            .clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        let r = (pcm_stereo[idx0 * 2 + 1] as f32 * inv + pcm_stereo[idx1 * 2 + 1] as f32 * frac)
            .round()
            .clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        out.push(l);
        out.push(r);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live M0 verification test: fetches a real public Bilibili video's DASH fMP4 audio prefix
    /// and verifies `symphonia` demuxes & decodes frames + computes FFT spectrum.
    #[tokio::test]
    async fn verify_bilibili_fmp4_audio_decode() {
        let mut client = bili_api::BiliClient::new().expect("bili client");
        let detail = client
            .get_video_detail("BV1GJ411x7h7")
            .await
            .expect("fetch video detail");
        let streams = client
            .get_dash_audio_streams(&detail.bvid, detail.cid)
            .await
            .expect("fetch dash streams");
        let top = &streams[0];
        println!(
            "STREAM CANDIDATE: id={} label={} codec={} mime={} bw={}",
            top.id, top.quality_label, top.codec, top.mime_type, top.bandwidth
        );

        let full_audio = download_stream_bytes(client.http(), &top.base_url, None)
            .await
            .expect("download full dash audio");
        println!("DOWNLOADED BYTES: {}", full_audio.len());

        // Inspect top-level MP4 boxes
        let mut off = 0usize;
        let mut boxes = Vec::new();
        while off + 8 <= full_audio.len() && boxes.len() < 12 {
            let sz = u32::from_be_bytes([
                full_audio[off],
                full_audio[off + 1],
                full_audio[off + 2],
                full_audio[off + 3],
            ]) as usize;
            let tag = String::from_utf8_lossy(&full_audio[off + 4..off + 8]).to_string();
            boxes.push(format!("{tag}:{sz}"));
            if sz < 8 {
                break;
            }
            off = off.saturating_add(sz);
        }
        println!("MP4 BOXES: {}", boxes.join(", "));

        let (summary, pcm) =
            decode_audio_bytes(full_audio, Some("m4a"), Some(240)).expect("symphonia decode");
        println!(
            "VERIFIED BILI STREAM: bvid={} title='{}' quality={} codec={} sr={} ch={} frames={} samples={} rms={:.4}",
            detail.bvid,
            detail.title,
            top.quality_label,
            summary.codec,
            summary.sample_rate,
            summary.channels,
            summary.frames_decoded,
            summary.samples_decoded,
            summary.peak_rms
        );
        assert!(summary.frames_decoded >= 10);
        assert!(summary.sample_rate >= 44100);
        assert!(!pcm.is_empty());
        assert_eq!(summary.sample_spectrum.len(), 28);
    }

    #[tokio::test]
    async fn verify_bilibili_fmp4_range_prefix_decode() {
        let mut client = bili_api::BiliClient::new().expect("bili client");
        let detail = client
            .get_video_detail("BV1GJ411x7h7")
            .await
            .expect("fetch video detail");
        let streams = client
            .get_dash_audio_streams(&detail.bvid, detail.cid)
            .await
            .expect("fetch dash streams");
        let top = &streams[0];
        let prefix = download_stream_bytes(client.http(), &top.base_url, Some(512 * 1024))
            .await
            .expect("download 512KB dash prefix");

        let (summary, pcm) = decode_audio_bytes_with_mode(prefix, Some("m4a"), None, false)
            .expect("symphonia progressive non-seekable decode");
        println!(
            "VERIFIED BILI 512KB PREFIX: frames={} samples={} sr={} rms={:.4}",
            summary.frames_decoded, summary.samples_decoded, summary.sample_rate, summary.peak_rms
        );
        assert!(summary.frames_decoded >= 50);
        assert!(!pcm.is_empty());
    }
}
