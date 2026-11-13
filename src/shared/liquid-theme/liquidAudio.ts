import type { LiquidDirection, LiquidRevealStage, LiquidSoundAdapter } from "./types";

/**
 * Local Web Audio API synthesizer for Liquid Theme Reveal:
 * - Zero external audio assets or remote fetches.
 * - Lazy AudioContext created/resumed strictly inside user gestures.
 * - Stage-driven triggering (pour -> impact splash -> rising flow -> settle chime).
 * - Differentiates tonal warmth: "to-dark" is deeper/warmer; "to-light" is brighter/crisper.
 */
export class WebAudioLiquidSound implements LiquidSoundAdapter {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private masterGain: GainNode | null = null;

  private activeVolume = 0.45;
  private triggeredStages = new Set<LiquidRevealStage>();

  // Continuous rising stream nodes
  private flowSource: AudioBufferSourceNode | null = null;
  private flowBandpass: BiquadFilterNode | null = null;
  private flowLowpass: BiquadFilterNode | null = null;
  private flowGain: GainNode | null = null;
  private flowLfo: OscillatorNode | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      if (!this.ctx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.activeVolume;
        this.masterGain.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") {
        void this.ctx.resume().catch(() => {});
      }
      if (!this.noiseBuffer && this.ctx) {
        this.noiseBuffer = this.buildPinkNoiseBuffer(this.ctx, 2.2);
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private buildPinkNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Paul Kellet pink-noise approximation for soft water texture
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const sample = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.085;
      b6 = white * 0.115926;
      data[i] = sample;
    }

    // Crossfade end into start for seamless looping
    const fadeLen = Math.min(2048, Math.floor(length / 8));
    for (let i = 0; i < fadeLen; i++) {
      const alpha = i / fadeLen;
      const tailIdx = length - fadeLen + i;
      data[i] = data[i] * alpha + data[tailIdx] * (1 - alpha);
    }

    return buffer;
  }

  private isAudible(volume: number): boolean {
    return Number.isFinite(volume) && volume > 0.005;
  }

  setVolume(volume: number): void {
    this.activeVolume = Math.max(0, Math.min(1, volume));
    if (!this.ctx || !this.masterGain) return;
    try {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.activeVolume, now, 0.025);
      if (!this.isAudible(this.activeVolume)) {
        this.stopFlowNodes(0.02);
      }
    } catch {
      // Audio failure must never disrupt theme transition
    }
  }

  start(direction: LiquidDirection, volume: number): void {
    this.abort();
    this.activeVolume = Math.max(0, Math.min(1, volume));
    if (!this.isAudible(this.activeVolume)) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    this.masterGain.gain.setValueAtTime(this.activeVolume, ctx.currentTime);

    this.triggeredStages.add("pouring");
    this.playPourStart(ctx, direction);
  }

  onProgress(progress: number, stage: LiquidRevealStage, direction: LiquidDirection): void {
    if (!this.isAudible(this.activeVolume)) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    try {
      if (stage === "impact" && !this.triggeredStages.has("impact")) {
        this.triggeredStages.add("impact");
        this.playSplashImpact(ctx, direction);
        this.startFlowLoop(ctx, direction);
      }

      if ((stage === "impact" || stage === "rising") && this.flowBandpass) {
        const norm = Math.max(0, Math.min(1, (progress - 0.25) / 0.72));
        const freq =
          direction === "to-dark"
            ? 420 - norm * 165 // gradually deepens as dark pool rises
            : 660 + norm * 560; // gently brightens as light wave fills
        this.flowBandpass.frequency.setTargetAtTime(freq, ctx.currentTime, 0.06);
      }

      if (stage === "completing" && !this.triggeredStages.has("completing")) {
        this.triggeredStages.add("completing");
        this.stopFlowNodes(0.11);
      }
    } catch {
      // Graceful no-op on audio error
    }
  }

  complete(direction: LiquidDirection): void {
    this.stopFlowNodes(0.08);
    if (!this.isAudible(this.activeVolume)) {
      this.triggeredStages.clear();
      return;
    }
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;
    try {
      this.playSettleChime(ctx, direction);
    } catch {
      // ignore
    } finally {
      this.triggeredStages.clear();
    }
  }

  abort(): void {
    this.triggeredStages.clear();
    this.stopFlowNodes(0.025);
  }

  playReducedCue(direction: LiquidDirection, volume: number): void {
    this.activeVolume = Math.max(0, Math.min(1, volume));
    if (!this.isAudible(this.activeVolume)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    this.masterGain.gain.setValueAtTime(this.activeVolume, ctx.currentTime);
    try {
      this.playDropletTone(
        ctx,
        ctx.currentTime,
        direction === "to-dark" ? 310 : 540,
        direction === "to-dark" ? 210 : 760,
        0.1,
        0.18
      );
    } catch {
      // ignore
    }
  }

  preview(direction: LiquidDirection, volume: number): void {
    this.activeVolume = Math.max(0, Math.min(1, volume));
    if (!this.isAudible(this.activeVolume)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    this.masterGain.gain.setValueAtTime(this.activeVolume, ctx.currentTime);

    try {
      const t0 = ctx.currentTime;
      this.playPourStart(ctx, direction);
      this.playSplashImpactAt(ctx, direction, t0 + 0.22);
      this.playSettleChimeAt(ctx, direction, t0 + 0.46);
    } catch {
      // ignore
    }
  }

  dispose(): void {
    this.abort();
    if (this.ctx) {
      const old = this.ctx;
      this.ctx = null;
      this.masterGain = null;
      this.noiseBuffer = null;
      void old.close().catch(() => {});
    }
  }

  private playPourStart(ctx: AudioContext, direction: LiquidDirection): void {
    const t0 = ctx.currentTime;
    if (direction === "to-dark") {
      this.playDropletTone(ctx, t0, 310, 165, 0.14, 0.22);
    } else {
      this.playDropletTone(ctx, t0, 490, 810, 0.13, 0.18);
    }
  }

  private playSplashImpact(ctx: AudioContext, direction: LiquidDirection): void {
    this.playSplashImpactAt(ctx, direction, ctx.currentTime);
  }

  private playSplashImpactAt(
    ctx: AudioContext,
    direction: LiquidDirection,
    t0: number
  ): void {
    if (!this.masterGain || !this.noiseBuffer) return;

    // Gentle filtered water burst
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(direction === "to-dark" ? 560 : 1140, t0);
    bp.Q.setValueAtTime(1.6, t0);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    src.start(t0);
    src.stop(t0 + 0.2);

    // Subtle secondary micro-droplet pings
    const base = direction === "to-dark" ? 280 : 620;
    this.playDropletTone(ctx, t0 + 0.015, base, base * 1.28, 0.065, 0.08);
    this.playDropletTone(ctx, t0 + 0.055, base * 1.18, base * 1.45, 0.06, 0.06);
  }

  private startFlowLoop(ctx: AudioContext, direction: LiquidDirection): void {
    if (!this.masterGain || !this.noiseBuffer) return;
    this.stopFlowNodes(0.015);

    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(direction === "to-dark" ? 950 : 2100, t0);

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(direction === "to-dark" ? 420 : 680, t0);
    bp.Q.setValueAtTime(1.15, t0);

    // Subtle shimmer LFO on filter cutoff
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(3.2, t0);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(direction === "to-dark" ? 45 : 90, t0);
    lfo.connect(lfoGain);
    lfoGain.connect(bp.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.09);

    src.connect(lp);
    lp.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);

    src.start(t0);
    lfo.start(t0);

    this.flowSource = src;
    this.flowLowpass = lp;
    this.flowBandpass = bp;
    this.flowGain = g;
    this.flowLfo = lfo;
  }

  private stopFlowNodes(fadeSec: number): void {
    const ctx = this.ctx;
    const src = this.flowSource;
    const g = this.flowGain;
    const lfo = this.flowLfo;
    const lp = this.flowLowpass;
    const bp = this.flowBandpass;

    this.flowSource = null;
    this.flowGain = null;
    this.flowLfo = null;
    this.flowLowpass = null;
    this.flowBandpass = null;

    if (!ctx || !g || !src) return;
    try {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
      const stopAt = now + fadeSec + 0.02;
      src.stop(stopAt);
      lfo?.stop(stopAt);
      src.onended = () => {
        try {
          src.disconnect();
          lp?.disconnect();
          bp?.disconnect();
          g.disconnect();
          lfo?.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }

  private playSettleChime(ctx: AudioContext, direction: LiquidDirection): void {
    this.playSettleChimeAt(ctx, direction, ctx.currentTime);
  }

  private playSettleChimeAt(
    ctx: AudioContext,
    direction: LiquidDirection,
    t0: number
  ): void {
    if (!this.masterGain) return;
    const freqs = direction === "to-dark" ? [220, 329.63] : [523.25, 783.99];
    freqs.forEach((hz, idx) => {
      const osc = ctx.createOscillator();
      osc.type = idx === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(hz, t0);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(idx === 0 ? 0.09 : 0.045, t0 + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);

      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.26);
    });
  }

  private playDropletTone(
    ctx: AudioContext,
    t0: number,
    fStart: number,
    fEnd: number,
    dur: number,
    peak: number
  ): void {
    if (!this.masterGain) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t0 + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}

export const sharedLiquidSound = new WebAudioLiquidSound();
