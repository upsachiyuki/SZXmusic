#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use bili_api::{
    extract_bvid, BiliClient, BiliCredentials, BiliUserInfo, QrLoginStart, QrPollStatus,
    SearchVideoItem, TrackLyricsBundle,
};
use library::{
    CustomRuleDto, LibrarySnapshot, LibraryStore, LibraryTrack, ParsedSeedMedia, SyncResult,
};
use player::{AudioEngine, BiliPlaySummary};
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, State, WindowEvent,
};
use title_parser::ParsedTrack;
use win_integration::{
    apply_window_glass, dpapi_protect, dpapi_unprotect, get_windows_registry_status,
    hwnd_from_window, is_alt_pressed, is_other_app_fullscreen, register_windows_app,
    set_widget_wallpaper_layer, set_window_corner_rounded, set_windows_autostart,
    trim_process_working_set, unregister_windows_app, WinRegistryStatus,
};

struct AppRuntimeState {
    bili: Arc<tokio::sync::Mutex<BiliClient>>,
    library: Arc<LibraryStore>,
    engine: Arc<AudioEngine>,
    data_dir: PathBuf,
    cache_dir: PathBuf,
    stream_status: Arc<Mutex<String>>,
    user_wants_widget: Arc<AtomicBool>,
    click_through: Arc<AtomicBool>,
    always_on_top: Arc<AtomicBool>,
    widget_size: Arc<Mutex<String>>,
    widget_anchor: Arc<Mutex<String>>,
}

fn widget_dimensions_for_size(size: &str) -> (f64, f64) {
    match size {
        "S" => (340.0, 92.0),
        "L" => (368.0, 468.0),
        _ => (356.0, 336.0),
    }
}

fn apply_widget_geometry(widget_win: &tauri::WebviewWindow, size: &str, anchor: &str) {
    let (w, h) = widget_dimensions_for_size(size);
    let _ = widget_win.set_size(Size::Logical(LogicalSize::new(w, h)));

    let monitor = widget_win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| widget_win.primary_monitor().ok().flatten());

    if let Some(mon) = monitor {
        let scale = mon.scale_factor().max(1.0);
        let mon_pos = mon.position();
        let origin_x = mon_pos.x as f64 / scale;
        let origin_y = mon_pos.y as f64 / scale;
        let logical_w = mon.size().width as f64 / scale;
        let logical_h = mon.size().height as f64 / scale;

        let margin_x = 24.0;
        let margin_top = 26.0;
        let margin_bottom = 64.0; // Leave room for Windows taskbar

        let right_x = origin_x + (logical_w - w - margin_x).max(16.0);
        let left_x = origin_x + margin_x;
        let top_y = origin_y + margin_top;
        let bottom_y = origin_y + (logical_h - h - margin_bottom).max(16.0);

        let (x, y) = match anchor {
            "bottom-right" => (right_x, bottom_y),
            "top-left" => (left_x, top_y),
            "bottom-left" => (left_x, bottom_y),
            _ => (right_x, top_y),
        };
        let _ = widget_win.set_position(Position::Logical(LogicalPosition::new(x, y)));
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchParsedItem {
    video: SearchVideoItem,
    parsed: ParsedTrack,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlinePlayResponse {
    track: LibraryTrack,
    snapshot: LibrarySnapshot,
    summary: BiliPlaySummary,
}

fn session_path(data_dir: &Path) -> PathBuf {
    data_dir.join("session.dpapi")
}

fn load_saved_credentials(data_dir: &Path) -> Option<BiliCredentials> {
    let bytes = std::fs::read(session_path(data_dir)).ok()?;
    let plain = dpapi_unprotect(&bytes).ok()?;
    serde_json::from_slice::<BiliCredentials>(&plain).ok()
}

fn save_credentials(data_dir: &Path, creds: &BiliCredentials) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let plain = serde_json::to_vec(creds).map_err(|e| e.to_string())?;
    let cipher = dpapi_protect(&plain)?;
    std::fs::write(session_path(data_dir), cipher).map_err(|e| e.to_string())
}

#[tauri::command]
async fn bili_get_account_status(state: State<'_, AppRuntimeState>) -> Result<BiliUserInfo, String> {
    let mut client = state.bili.lock().await;
    client.get_nav_user().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn bili_auth_qr_start(state: State<'_, AppRuntimeState>) -> Result<QrLoginStart, String> {
    let mut client = state.bili.lock().await;
    client.qr_generate().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn bili_auth_qr_poll(
    qrcode_key: String,
    state: State<'_, AppRuntimeState>,
) -> Result<(QrPollStatus, Option<BiliUserInfo>), String> {
    let mut client = state.bili.lock().await;
    let poll = client.qr_poll(&qrcode_key).await.map_err(|e| e.to_string())?;
    if poll.status == "confirmed" {
        if let Some(creds) = &poll.credentials {
            save_credentials(&state.data_dir, creds)?;
        }
        let user = client.get_nav_user().await.map_err(|e| e.to_string())?;
        return Ok((poll, Some(user)));
    }
    Ok((poll, None))
}

#[tauri::command]
async fn bili_auth_logout(state: State<'_, AppRuntimeState>) -> Result<BiliUserInfo, String> {
    let _ = std::fs::remove_file(session_path(&state.data_dir));
    let mut client = state.bili.lock().await;
    client.clear_credentials();
    client.get_nav_user().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn lib_get_snapshot(state: State<'_, AppRuntimeState>) -> Result<LibrarySnapshot, String> {
    state.library.load_snapshot()
}

#[tauri::command]
async fn bili_sync_favorites(
    force_full: bool,
    app: tauri::AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<SyncResult, String> {
    let user = {
        let mut client = state.bili.lock().await;
        client.get_nav_user().await.map_err(|e| e.to_string())?
    };
    if !user.is_login || user.mid == 0 {
        return Err("请先扫码登录 B 站账号后再同步收藏夹".into());
    }
    let mut client = state.bili.lock().await;
    let res = state
        .library
        .sync_favorites(&mut client, user.mid, force_full, |ev| {
            let _ = app.emit("import://progress", ev);
        })
        .await?;
    let _ = app.emit("szx://library-synced", &res);
    Ok(res)
}

#[tauri::command]
async fn bili_search_and_parse(
    keyword: String,
    page: Option<u32>,
    state: State<'_, AppRuntimeState>,
) -> Result<Vec<SearchParsedItem>, String> {
    let items = {
        let mut client = state.bili.lock().await;
        client
            .search_videos(keyword.trim(), page.unwrap_or(1))
            .await
            .map_err(|e| e.to_string())?
    };
    let mut out = Vec::with_capacity(items.len());
    for video in items {
        let parsed = state
            .library
            .parse_preview(&video.title, &video.author, video.mid, &video.tag, "", None)?;
        out.push(SearchParsedItem { video, parsed });
    }
    Ok(out)
}

#[tauri::command]
async fn bili_play_online(
    input: String,
    cid: Option<u64>,
    preferred_quality: Option<u32>,
    state: State<'_, AppRuntimeState>,
) -> Result<OnlinePlayResponse, String> {
    let bvid = extract_bvid(&input).ok_or_else(|| format!("未识别到有效 BV 号: {input}"))?;
    let detail = {
        let mut client = state.bili.lock().await;
        client.get_video_detail(&bvid).await.map_err(|e| e.to_string())?
    };
    let target_cid = cid.filter(|&c| c > 0).unwrap_or(detail.cid);
    let page_info = detail.pages.iter().find(|p| p.cid == target_cid);
    let page_no = page_info.map(|p| p.page).unwrap_or(1);
    let part_name = page_info.map(|p| p.part.as_str()).unwrap_or("");

    let (track, snapshot) = state
        .library
        .upsert_online_track(&detail, target_cid, part_name, page_no)?;

    let summary = state
        .engine
        .play_bili_track(
            &state.bili,
            &detail.bvid,
            Some(target_cid),
            preferred_quality,
            Some(&state.cache_dir),
        )
        .await
        .map_err(|e| e.to_string())?;

    let msg = format!(
        "LIVE {}: {} {}Hz {}ch{}",
        summary.quality_label,
        summary.codec,
        summary.sample_rate,
        summary.channels,
        if summary.from_cache { " [CACHE]" } else { "" }
    );
    if let Ok(mut guard) = state.stream_status.lock() {
        *guard = msg;
    }

    Ok(OnlinePlayResponse {
        track,
        snapshot,
        summary,
    })
}

#[tauri::command]
async fn bili_fetch_related_crate(
    bvid: String,
    seed_title: String,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    let items = {
        let mut client = state.bili.lock().await;
        client
            .get_related_videos(bvid.trim())
            .await
            .map_err(|e| e.to_string())?
    };
    let seeds: Vec<ParsedSeedMedia> = items
        .into_iter()
        .take(16)
        .map(|r| ParsedSeedMedia {
            aid: r.aid,
            bvid: r.bvid,
            cid: r.cid,
            raw_title: r.title,
            owner_mid: r.owner_mid,
            owner_name: r.owner_name,
            cover_url: r.pic,
            duration_sec: r.duration_sec,
            tname: r.tname,
        })
        .collect();
    state.library.upsert_related_crate(
        &format!("similar-{bvid}"),
        &format!("相似 · {seed_title}"),
        &seeds,
    )
}

#[tauri::command]
fn lib_confirm_pending(
    track_id: String,
    title: String,
    artist: String,
    version: String,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state
        .library
        .confirm_pending(&track_id, &title, &artist, &version)
}

#[tauri::command]
fn lib_dismiss_pending(
    track_id: String,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state.library.dismiss_pending(&track_id)
}

#[tauri::command]
fn lib_dismiss_all_pending(
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state.library.dismiss_all_pending()
}

#[tauri::command]
fn lib_confirm_all_pending(
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state.library.confirm_all_pending()
}

#[tauri::command]
fn lib_toggle_like(track_id: String, state: State<'_, AppRuntimeState>) -> Result<Vec<String>, String> {
    state.library.toggle_like(&track_id)
}

#[tauri::command]
fn lib_create_crate(
    title: String,
    subtitle: String,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state.library.create_crate(&title, &subtitle)
}

#[tauri::command]
fn lib_rename_crate(
    crate_id: String,
    title: String,
    subtitle: Option<String>,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state
        .library
        .rename_crate(&crate_id, &title, subtitle.as_deref())
}

#[tauri::command]
fn lib_delete_crate(
    crate_id: String,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state.library.delete_crate(&crate_id)
}

#[tauri::command]
fn lib_add_track_to_crate(
    crate_id: String,
    track: LibraryTrack,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state.library.add_track_to_crate(&crate_id, &track)
}

#[tauri::command]
fn lib_remove_track_from_crate(
    crate_id: String,
    track_id: String,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state.library.remove_track_from_crate(&crate_id, &track_id)
}

#[tauri::command]
fn lib_transfer_tracks(
    from_crate_id: String,
    to_crate_id: String,
    bvid_filter: Option<String>,
    move_tracks: bool,
    state: State<'_, AppRuntimeState>,
) -> Result<LibrarySnapshot, String> {
    state.library.transfer_tracks(
        &from_crate_id,
        &to_crate_id,
        bvid_filter.as_deref(),
        move_tracks,
    )
}

#[tauri::command]
fn lib_create_crate_and_transfer(
    title: String,
    subtitle: String,
    from_crate_id: String,
    bvid_filter: Option<String>,
    move_tracks: bool,
    state: State<'_, AppRuntimeState>,
) -> Result<(String, LibrarySnapshot), String> {
    state.library.create_crate_and_transfer(
        &title,
        &subtitle,
        &from_crate_id,
        bvid_filter.as_deref(),
        move_tracks,
    )
}

#[tauri::command]
fn lib_list_rules(state: State<'_, AppRuntimeState>) -> Result<Vec<CustomRuleDto>, String> {
    state.library.list_custom_rules()
}

#[tauri::command]
fn lib_add_rule(
    uploader_mid: u64,
    pattern: String,
    priority: i32,
    description: String,
    state: State<'_, AppRuntimeState>,
) -> Result<Vec<CustomRuleDto>, String> {
    state
        .library
        .add_custom_rule(uploader_mid, &pattern, priority, &description)
}

#[tauri::command]
fn lib_delete_rule(
    id: String,
    state: State<'_, AppRuntimeState>,
) -> Result<Vec<CustomRuleDto>, String> {
    state.library.delete_custom_rule(&id)
}

#[tauri::command]
fn lib_test_parser(
    raw_title: String,
    owner_name: String,
    owner_mid: u64,
    tname: String,
    part_name: String,
    custom_pattern: Option<String>,
    state: State<'_, AppRuntimeState>,
) -> Result<ParsedTrack, String> {
    state.library.parse_preview(
        &raw_title,
        &owner_name,
        owner_mid,
        &tname,
        &part_name,
        custom_pattern.as_deref(),
    )
}

#[tauri::command]
fn lib_get_sync_interval(state: State<'_, AppRuntimeState>) -> u32 {
    state
        .library
        .get_setting("sync_interval_min")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(15)
}

#[tauri::command]
fn lib_set_sync_interval(minutes: u32, state: State<'_, AppRuntimeState>) -> Result<(), String> {
    state
        .library
        .set_setting("sync_interval_min", &minutes.to_string())
}

#[tauri::command]
async fn bili_get_track_lyrics(
    bvid: String,
    cid: Option<u64>,
    title: Option<String>,
    artist: Option<String>,
    state: State<'_, AppRuntimeState>,
) -> Result<TrackLyricsBundle, String> {
    let mut client = state.bili.lock().await;
    client
        .get_track_lyrics_bundle(
            bvid.trim(),
            cid,
            title.as_deref().unwrap_or(""),
            artist.as_deref().unwrap_or(""),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn player_play_bili_stream(
    bvid: String,
    cid: Option<u64>,
    preferred_quality: Option<u32>,
    state: State<'_, AppRuntimeState>,
) -> Result<BiliPlaySummary, String> {
    let summary = state
        .engine
        .play_bili_track(
            &state.bili,
            bvid.trim(),
            cid,
            preferred_quality,
            Some(&state.cache_dir),
        )
        .await
        .map_err(|e| e.to_string())?;
    let msg = format!(
        "LIVE {}: {} {}Hz {}ch{}",
        summary.quality_label,
        summary.codec,
        summary.sample_rate,
        summary.channels,
        if summary.from_cache { " [CACHE]" } else { "" }
    );
    if let Ok(mut guard) = state.stream_status.lock() {
        *guard = msg;
    }
    trim_process_working_set();
    Ok(summary)
}

#[tauri::command]
fn player_seek(position_sec: f64, state: State<'_, AppRuntimeState>) {
    state.engine.seek(position_sec);
}

#[tauri::command]
fn player_stop_stream(state: State<'_, AppRuntimeState>) {
    state.engine.stop();
    trim_process_working_set();
}

#[tauri::command]
fn player_set_paused(paused: bool, state: State<'_, AppRuntimeState>) {
    state.engine.set_paused(paused);
}

#[tauri::command]
fn player_set_volume(volume: f32, state: State<'_, AppRuntimeState>) {
    state.engine.set_volume(volume);
}

#[tauri::command]
fn win_show_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn win_toggle_widget(
    app: tauri::AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("widget") {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            state.user_wants_widget.store(false, Ordering::Relaxed);
            let _ = win.hide();
        } else {
            state.user_wants_widget.store(true, Ordering::Relaxed);
            let _ = win.show();
        }
    }
    Ok(())
}

#[tauri::command]
fn win_resize_widget(
    app: tauri::AppHandle,
    size: String,
    state: State<'_, AppRuntimeState>,
) -> Result<(), String> {
    let normalized = match size.as_str() {
        "S" => "S",
        "L" => "L",
        _ => "M",
    };
    if let Ok(mut guard) = state.widget_size.lock() {
        *guard = normalized.to_string();
    }
    let _ = state.library.set_setting("widget_size", normalized);
    let anchor = state
        .widget_anchor
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "top-right".to_string());
    if let Some(win) = app.get_webview_window("widget") {
        apply_widget_geometry(&win, normalized, &anchor);
    }
    Ok(())
}

#[tauri::command]
fn win_set_click_through(
    app: tauri::AppHandle,
    enabled: bool,
    state: State<'_, AppRuntimeState>,
) -> Result<(), String> {
    state.click_through.store(enabled, Ordering::Relaxed);
    if let Some(win) = app.get_webview_window("widget") {
        let _ = win.set_ignore_cursor_events(enabled);
    }
    Ok(())
}

#[tauri::command]
fn win_set_always_on_top(
    app: tauri::AppHandle,
    enabled: bool,
    state: State<'_, AppRuntimeState>,
) -> Result<(), String> {
    state.always_on_top.store(enabled, Ordering::Relaxed);
    if let Some(win) = app.get_webview_window("widget") {
        let _ = win.set_always_on_top(enabled);
        set_widget_wallpaper_layer(&win, !enabled);
    }
    Ok(())
}

#[tauri::command]
fn win_set_widget_anchor(
    app: tauri::AppHandle,
    anchor: String,
    state: State<'_, AppRuntimeState>,
) -> Result<(), String> {
    let normalized = match anchor.as_str() {
        "bottom-right" => "bottom-right",
        "top-left" => "top-left",
        "bottom-left" => "bottom-left",
        _ => "top-right",
    };
    if let Ok(mut guard) = state.widget_anchor.lock() {
        *guard = normalized.to_string();
    }
    let _ = state.library.set_setting("widget_anchor", normalized);
    let size = state
        .widget_size
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "M".to_string());
    if let Some(widget_win) = app.get_webview_window("widget") {
        apply_widget_geometry(&widget_win, &size, normalized);
    }
    Ok(())
}

#[tauri::command]
fn win_set_autostart(
    enabled: bool,
    state: State<'_, AppRuntimeState>,
) -> Result<WinRegistryStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_string_lossy().to_string();
    set_windows_autostart(enabled, "SZXmusic", &exe_str)?;
    let _ = state
        .library
        .set_setting("autostart", if enabled { "1" } else { "0" });
    Ok(get_windows_registry_status("SZXmusic", "szxmusic", &exe_str))
}

#[tauri::command]
fn win_get_registry_status() -> Result<WinRegistryStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(get_windows_registry_status(
        "SZXmusic",
        "szxmusic",
        &exe.to_string_lossy(),
    ))
}

#[tauri::command]
fn win_register_app(state: State<'_, AppRuntimeState>) -> Result<WinRegistryStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let _ = state.library.set_setting("registry_auto", "1");
    register_windows_app(
        "SZXmusic",
        "szxmusic",
        "com.szxmusic.app",
        env!("CARGO_PKG_VERSION"),
        &exe.to_string_lossy(),
    )
}

#[tauri::command]
fn win_unregister_app(state: State<'_, AppRuntimeState>) -> Result<WinRegistryStatus, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let _ = state.library.set_setting("registry_auto", "0");
    let _ = state.library.set_setting("autostart", "0");
    unregister_windows_app("SZXmusic", "szxmusic", &exe.to_string_lossy())
}

#[tauri::command]
fn win_minimize_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn win_toggle_maximize_main(app: tauri::AppHandle) -> Result<bool, String> {
    let Some(win) = app.get_webview_window("main") else {
        return Ok(false);
    };
    let was_max = win.is_maximized().unwrap_or(false);
    if was_max {
        win.unmaximize().map_err(|e| e.to_string())?;
    } else {
        win.maximize().map_err(|e| e.to_string())?;
    }
    let now_max = win.is_maximized().unwrap_or(!was_max);
    set_window_corner_rounded(&win, !now_max);
    let _ = app.emit("szx://window-maximized", now_max);
    Ok(now_max)
}

#[tauri::command]
fn win_set_theme(app: tauri::AppHandle, dark: bool) {
    if let Some(w) = app.get_webview_window("main") {
        apply_window_glass(&w, dark);
    }
    if let Some(w) = app.get_webview_window("widget") {
        apply_window_glass(&w, dark);
    }
}

fn default_app_data_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("SZXmusic")
}

fn main() {
    let widget_only = std::env::args().any(|a| a == "--widget-only");
    let data_dir = default_app_data_dir();
    let cache_dir = data_dir.join("audio_cache");
    player::prune_disk_cache(&cache_dir);
    let db_path = data_dir.join("library.db");

    let mut bili_client = BiliClient::new().expect("failed to init bili client");
    if let Some(creds) = load_saved_credentials(&data_dir) {
        if creds.is_logged_in() {
            bili_client.set_credentials(creds);
        }
    }

    let bili = Arc::new(tokio::sync::Mutex::new(bili_client));
    let library = Arc::new(LibraryStore::open(&db_path).expect("failed to init SQLite library"));
    let engine = Arc::new(AudioEngine::new());
    let stream_status = Arc::new(Mutex::new("就绪 · 支持 B 站扫码与实时解码".to_string()));
    let user_wants_widget = Arc::new(AtomicBool::new(true));
    let click_through = Arc::new(AtomicBool::new(false));
    let always_on_top = Arc::new(AtomicBool::new(false));

    let initial_widget_size = library
        .get_setting("widget_size")
        .filter(|s| matches!(s.as_str(), "S" | "M" | "L"))
        .unwrap_or_else(|| "M".to_string());
    let initial_widget_anchor = library
        .get_setting("widget_anchor")
        .filter(|s| matches!(s.as_str(), "top-right" | "bottom-right" | "top-left" | "bottom-left"))
        .unwrap_or_else(|| "top-right".to_string());

    let widget_size = Arc::new(Mutex::new(initial_widget_size.clone()));
    let widget_anchor = Arc::new(Mutex::new(initial_widget_anchor.clone()));

    let runtime_state = AppRuntimeState {
        bili: Arc::clone(&bili),
        library: Arc::clone(&library),
        engine: Arc::clone(&engine),
        data_dir,
        cache_dir,
        stream_status: Arc::clone(&stream_status),
        user_wants_widget: Arc::clone(&user_wants_widget),
        click_through: Arc::clone(&click_through),
        always_on_top: Arc::clone(&always_on_top),
        widget_size: Arc::clone(&widget_size),
        widget_anchor: Arc::clone(&widget_anchor),
    };

    tauri::Builder::default()
        .manage(runtime_state)
        .invoke_handler(tauri::generate_handler![
            bili_get_account_status,
            bili_auth_qr_start,
            bili_auth_qr_poll,
            bili_auth_logout,
            bili_sync_favorites,
            bili_search_and_parse,
            bili_play_online,
            bili_fetch_related_crate,
            bili_get_track_lyrics,
            lib_get_snapshot,
            lib_confirm_pending,
            lib_dismiss_pending,
            lib_dismiss_all_pending,
            lib_confirm_all_pending,
            lib_toggle_like,
            lib_create_crate,
            lib_rename_crate,
            lib_delete_crate,
            lib_add_track_to_crate,
            lib_remove_track_from_crate,
            lib_transfer_tracks,
            lib_create_crate_and_transfer,
            lib_list_rules,
            lib_add_rule,
            lib_delete_rule,
            lib_test_parser,
            lib_get_sync_interval,
            lib_set_sync_interval,
            player_play_bili_stream,
            player_seek,
            player_stop_stream,
            player_set_paused,
            player_set_volume,
            win_show_main,
            win_toggle_widget,
            win_resize_widget,
            win_set_click_through,
            win_set_always_on_top,
            win_set_widget_anchor,
            win_set_autostart,
            win_get_registry_status,
            win_register_app,
            win_unregister_app,
            win_minimize_main,
            win_toggle_maximize_main,
            win_set_theme,
        ])
        .setup(move |app| {
            // Auto-register App Paths, protocol (`szxmusic://`), and HKCU app entry unless user opted out
            if library.get_setting("registry_auto").as_deref() != Some("0") {
                if let Ok(exe) = std::env::current_exe() {
                    let _ = register_windows_app(
                        "SZXmusic",
                        "szxmusic",
                        "com.szxmusic.app",
                        env!("CARGO_PKG_VERSION"),
                        &exe.to_string_lossy(),
                    );
                }
            }

            // Apply Liquid Glass (Windows Acrylic + DWM rounded corners) to both windows.
            if let Some(main_win) = app.get_webview_window("main") {
                apply_window_glass(&main_win, true);
                if widget_only {
                    let _ = main_win.hide();
                }
                let main_clone = main_win.clone();
                let app_handle = app.handle().clone();
                main_win.on_window_event(move |event| {
                    match event {
                        WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let _ = main_clone.hide();
                            trim_process_working_set();
                        }
                        WindowEvent::Resized(_) => {
                            let is_max = main_clone.is_maximized().unwrap_or(false);
                            set_window_corner_rounded(&main_clone, !is_max);
                            let _ = app_handle.emit("szx://window-maximized", is_max);
                        }
                        _ => {}
                    }
                });
            }

            if let Some(widget_win) = app.get_webview_window("widget") {
                apply_window_glass(&widget_win, true);
                let _ = widget_win.set_always_on_top(false);
                apply_widget_geometry(&widget_win, &initial_widget_size, &initial_widget_anchor);
                set_widget_wallpaper_layer(&widget_win, true);
            }

            // Build system tray menu.
            let show_main = MenuItem::with_id(app, "show_main", "打开主界面", true, None::<&str>)?;
            let toggle_widget =
                MenuItem::with_id(app, "toggle_widget", "显示 / 隐藏挂件", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 SZXmusic", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_main, &toggle_widget, &quit])?;

            let mut tray_builder = TrayIconBuilder::new().menu(&menu).tooltip("SZXmusic");
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder
                .on_menu_event(|app, ev| match ev.id.as_ref() {
                    "show_main" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "toggle_widget" => {
                        let st = app.state::<AppRuntimeState>();
                        if let Some(win) = app.get_webview_window("widget") {
                            let vis = win.is_visible().unwrap_or(false);
                            st.user_wants_widget.store(!vis, Ordering::Relaxed);
                            if vis {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Background watcher: fullscreen auto-hide + Alt temporary click-through override.
            let app_watch = app.handle().clone();
            let wants_widget = Arc::clone(&user_wants_widget);
            let ct_flag = Arc::clone(&click_through);
            let aot_flag = Arc::clone(&always_on_top);
            tauri::async_runtime::spawn(async move {
                let mut hidden_by_fs = false;
                let mut prev_ignore = false;
                loop {
                    tokio::time::sleep(Duration::from_millis(220)).await;
                    let Some(widget_win) = app_watch.get_webview_window("widget") else {
                        continue;
                    };

                    let mut own_hwnds = Vec::new();
                    if let Some(h) = hwnd_from_window(&widget_win) {
                        own_hwnds.push(h);
                    }
                    if let Some(main_win) = app_watch.get_webview_window("main") {
                        if let Some(h) = hwnd_from_window(&main_win) {
                            own_hwnds.push(h);
                        }
                    }

                    if wants_widget.load(Ordering::Relaxed) && aot_flag.load(Ordering::Relaxed) {
                        let fs = is_other_app_fullscreen(&own_hwnds);
                        if fs && !hidden_by_fs {
                            let _ = widget_win.hide();
                            hidden_by_fs = true;
                        } else if !fs && hidden_by_fs {
                            let _ = widget_win.show();
                            hidden_by_fs = false;
                        }
                    } else if wants_widget.load(Ordering::Relaxed) && !aot_flag.load(Ordering::Relaxed) {
                        // Keep widget pinned on the desktop wallpaper layer (`HWND_BOTTOM`)
                        set_widget_wallpaper_layer(&widget_win, true);
                    }

                    let want_ct = ct_flag.load(Ordering::Relaxed);
                    let effective_ignore = want_ct && !is_alt_pressed();
                    if effective_ignore != prev_ignore {
                        let _ = widget_win.set_ignore_cursor_events(effective_ignore);
                        prev_ignore = effective_ignore;
                    }
                }
            });

            // Background incremental favorite sync watcher (defaults to startup + every 15 mins).
            let app_sync = app.handle().clone();
            let bili_sync = Arc::clone(&bili);
            let lib_sync = Arc::clone(&library);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                let mut last_sync = Instant::now() - Duration::from_secs(3600);
                loop {
                    let interval_min = lib_sync
                        .get_setting("sync_interval_min")
                        .and_then(|s| s.parse::<u64>().ok())
                        .unwrap_or(15);

                    let should_run = interval_min > 0
                        && last_sync.elapsed() >= Duration::from_secs(interval_min * 60);

                    if should_run {
                        let mut client = bili_sync.lock().await;
                        if client.credentials().is_logged_in() {
                            if let Ok(user) = client.get_nav_user().await {
                                if user.is_login && user.mid > 0 {
                                    if let Ok(res) = lib_sync
                                        .sync_favorites(&mut client, user.mid, false, |ev| {
                                            let _ = app_sync.emit("import://progress", ev);
                                        })
                                        .await
                                    {
                                        let _ = app_sync.emit("szx://library-synced", &res);
                                    }
                                }
                            }
                        }
                        last_sync = Instant::now();
                    }
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
            });

            // Background telemetry & natural track-end emitter.
            let app_tel = app.handle().clone();
            let eng_tel = Arc::clone(&engine);
            let status_tel = Arc::clone(&stream_status);
            tauri::async_runtime::spawn(async move {
                loop {
                    if eng_tel.is_active() && !eng_tel.is_paused() {
                        tokio::time::sleep(Duration::from_millis(85)).await;
                        let status = status_tel
                            .lock()
                            .map(|g| g.clone())
                            .unwrap_or_else(|_| "LIVE".into());
                        let payload = eng_tel.telemetry_snapshot(&status);
                        let _ = app_tel.emit("player://telemetry", payload);
                    } else if eng_tel.take_ended() {
                        trim_process_working_set();
                        let _ = app_tel.emit("player://track-ended", ());
                    } else {
                        tokio::time::sleep(Duration::from_millis(260)).await;
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SZXmusic");
}
