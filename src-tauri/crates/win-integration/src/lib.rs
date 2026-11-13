use std::ffi::OsStr;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::Path;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde::{Deserialize, Serialize};
use window_vibrancy::apply_acrylic;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, ERROR_FILE_NOT_FOUND, HLOCAL, HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegDeleteValueW, RegOpenKeyExW,
    RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE,
    KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SAM_FLAGS, REG_SZ, REG_VALUE_TYPE,
};
use windows::Win32::System::Threading::{GetCurrentProcess, SetProcessWorkingSetSize};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU};
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
    QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos,
    GWL_EXSTYLE, HWND_BOTTOM, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

pub fn hwnd_from_window(win: &impl HasWindowHandle) -> Option<isize> {
    match win.window_handle().ok()?.as_raw() {
        RawWindowHandle::Win32(h) => Some(h.hwnd.get()),
        _ => None,
    }
}

/// Sets Windows 11 DWM rounded vs square window corners (square when maximized).
pub fn set_window_corner_rounded(win: &impl HasWindowHandle, rounded: bool) {
    if let Some(hwnd_val) = hwnd_from_window(win) {
        let hwnd = HWND(hwnd_val);
        let pref = if rounded { DWMWCP_ROUND } else { DWMWCP_DONOTROUND };
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                (&pref as *const _) as *const _,
                std::mem::size_of_val(&pref) as u32,
            );
        }
    }
}

/// Applies Windows Acrylic blur (L0) + Windows 11 rounded corners.
pub fn apply_window_glass(win: &impl HasWindowHandle, dark: bool) {
    let tint = if dark {
        (31, 30, 29, 130)
    } else {
        (250, 249, 245, 145)
    };
    let _ = apply_acrylic(win, Some(tint));
    set_window_corner_rounded(win, true);
}

/// Pins the desktop widget to the desktop wallpaper layer (`HWND_BOTTOM` + `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`)
/// so it sits on the wallpaper behind normal windows instead of acting as a floating window.
pub fn set_widget_wallpaper_layer(win: &impl HasWindowHandle, wallpaper_layer: bool) {
    let Some(hwnd_val) = hwnd_from_window(win) else {
        return;
    };
    let hwnd = HWND(hwnd_val);
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let desired_flags = (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) as isize;
        if (ex_style & desired_flags) != desired_flags {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | desired_flags);
        }
        let z_order = if wallpaper_layer {
            HWND_BOTTOM
        } else {
            HWND_TOPMOST
        };
        let _ = SetWindowPos(
            hwnd,
            z_order,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Returns true if another application is currently running fullscreen (game/video/presentation).
pub fn is_other_app_fullscreen(own_hwnds: &[isize]) -> bool {
    unsafe {
        if let Ok(state) = SHQueryUserNotificationState() {
            if state == QUNS_RUNNING_D3D_FULL_SCREEN
                || state == QUNS_PRESENTATION_MODE
                || state == QUNS_BUSY
            {
                let fg = GetForegroundWindow();
                if fg.0 != 0 && !own_hwnds.contains(&fg.0) {
                    return true;
                }
            }
        }

        let fg = GetForegroundWindow();
        if fg.0 == 0 || own_hwnds.contains(&fg.0) {
            return false;
        }

        let mut win_rect = RECT::default();
        if GetWindowRect(fg, &mut win_rect).is_err() {
            return false;
        }
        let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
            return false;
        }

        let m = mi.rcMonitor;
        win_rect.left <= m.left
            && win_rect.top <= m.top
            && win_rect.right >= m.right
            && win_rect.bottom >= m.bottom
    }
}

/// Detects whether either Alt key is currently held down.
pub fn is_alt_pressed() -> bool {
    unsafe { (GetAsyncKeyState(VK_MENU.0 as i32) as u16 & 0x8000) != 0 }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinRegistryStatus {
    pub autostart: bool,
    pub app_registered: bool,
    pub protocol_registered: bool,
    pub app_paths_registered: bool,
    pub exe_path: String,
}

const HKCU_RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const HKCU_APP_PATHS_PREFIX: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths";
const HKCU_REGISTERED_APPS: &str = "Software\\RegisteredApplications";

fn create_hkcu_key(subkey: &str, sam: REG_SAM_FLAGS) -> Result<HKEY, String> {
    let wide_subkey = to_wide(subkey);
    let mut hkey = HKEY::default();
    let res = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(wide_subkey.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            sam,
            None,
            &mut hkey,
            None,
        )
    };
    if res.is_err() {
        return Err(format!("无法创建或打开注册表项 {subkey}: {res:?}"));
    }
    Ok(hkey)
}

fn set_hkcu_sz(subkey: &str, value_name: Option<&str>, value: &str) -> Result<(), String> {
    let hkey = create_hkcu_key(subkey, KEY_SET_VALUE)?;
    let wide_val = to_wide(value);
    let bytes =
        unsafe { std::slice::from_raw_parts(wide_val.as_ptr() as *const u8, wide_val.len() * 2) };
    let wide_name = value_name.map(to_wide);
    let name_ptr = wide_name
        .as_ref()
        .map(|w| PCWSTR(w.as_ptr()))
        .unwrap_or(PCWSTR::null());

    let res = unsafe { RegSetValueExW(hkey, name_ptr, 0, REG_SZ, Some(bytes)) };
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if res.is_err() {
        return Err(format!("写入注册表值失败 ({subkey}): {res:?}"));
    }
    Ok(())
}

fn read_hkcu_sz(subkey: &str, value_name: Option<&str>) -> Option<String> {
    let wide_subkey = to_wide(subkey);
    let mut hkey = HKEY::default();
    let open_res = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(wide_subkey.as_ptr()),
            0,
            KEY_QUERY_VALUE,
            &mut hkey,
        )
    };
    if open_res.is_err() {
        return None;
    }

    let wide_name = value_name.map(to_wide);
    let name_ptr = wide_name
        .as_ref()
        .map(|w| PCWSTR(w.as_ptr()))
        .unwrap_or(PCWSTR::null());

    let mut reg_type = REG_VALUE_TYPE::default();
    let mut byte_len = 0u32;
    let first = unsafe {
        RegQueryValueExW(
            hkey,
            name_ptr,
            None,
            Some(&mut reg_type),
            None,
            Some(&mut byte_len),
        )
    };
    if first.is_err() || byte_len == 0 {
        unsafe {
            let _ = RegCloseKey(hkey);
        }
        return None;
    }

    let mut buf = vec![0u8; byte_len as usize];
    let second = unsafe {
        RegQueryValueExW(
            hkey,
            name_ptr,
            None,
            Some(&mut reg_type),
            Some(buf.as_mut_ptr()),
            Some(&mut byte_len),
        )
    };
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if second.is_err() {
        return None;
    }

    let u16_len = (byte_len as usize) / 2;
    let words: Vec<u16> = buf
        .chunks_exact(2)
        .take(u16_len)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let text = std::ffi::OsString::from_wide(&words)
        .to_string_lossy()
        .trim_end_matches('\0')
        .to_string();
    Some(text)
}

fn delete_hkcu_value(subkey: &str, value_name: &str) -> Result<(), String> {
    let wide_subkey = to_wide(subkey);
    let mut hkey = HKEY::default();
    let open_res = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(wide_subkey.as_ptr()),
            0,
            KEY_SET_VALUE,
            &mut hkey,
        )
    };
    if open_res == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    if open_res.is_err() {
        return Err(format!("打开注册表项失败 ({subkey}): {open_res:?}"));
    }
    let wide_name = to_wide(value_name);
    let del_res = unsafe { RegDeleteValueW(hkey, PCWSTR(wide_name.as_ptr())) };
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if del_res.is_err() && del_res != ERROR_FILE_NOT_FOUND {
        return Err(format!("移除注册表值失败 ({value_name}): {del_res:?}"));
    }
    Ok(())
}

fn delete_hkcu_tree(subkey: &str) -> Result<(), String> {
    let hkey = match create_hkcu_key("Software", KEY_WRITE) {
        Ok(h) => h,
        Err(e) => return Err(e),
    };
    let rel = subkey
        .strip_prefix("Software\\")
        .unwrap_or(subkey);
    let wide_rel = to_wide(rel);
    let res = unsafe { RegDeleteTreeW(hkey, PCWSTR(wide_rel.as_ptr())) };
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if res.is_err() && res != ERROR_FILE_NOT_FOUND {
        return Err(format!("删除注册表分支失败 ({subkey}): {res:?}"));
    }
    Ok(())
}

/// Checks whether the current executable is registered under HKCU Run for autostart.
pub fn is_windows_autostart_enabled(app_name: &str) -> bool {
    read_hkcu_sz(HKCU_RUN_KEY, Some(app_name))
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Registers or removes the current executable under HKCU Run for silent widget autostart.
pub fn set_windows_autostart(enabled: bool, app_name: &str, exe_path: &str) -> Result<(), String> {
    if enabled {
        let cmd = format!("\"{exe_path}\" --widget-only");
        set_hkcu_sz(HKCU_RUN_KEY, Some(app_name), &cmd)
    } else {
        delete_hkcu_value(HKCU_RUN_KEY, app_name)
    }
}

/// Queries current user-scope Windows registry registration and autostart status.
pub fn get_windows_registry_status(
    app_name: &str,
    protocol: &str,
    exe_path: &str,
) -> WinRegistryStatus {
    let exe_name = Path::new(exe_path)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("SZXmusic.exe");
    let app_key = format!("Software\\{app_name}");
    let app_paths_key = format!("{HKCU_APP_PATHS_PREFIX}\\{exe_name}");
    let protocol_cmd_key = format!("Software\\Classes\\{protocol}\\shell\\open\\command");

    WinRegistryStatus {
        autostart: is_windows_autostart_enabled(app_name),
        app_registered: read_hkcu_sz(&app_key, Some("ExePath"))
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        protocol_registered: read_hkcu_sz(&protocol_cmd_key, None)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        app_paths_registered: read_hkcu_sz(&app_paths_key, None)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        exe_path: exe_path.to_string(),
    }
}

/// Registers application metadata, App Paths, Capabilities, and custom URL scheme (`szxmusic://`) under HKCU.
pub fn register_windows_app(
    app_name: &str,
    protocol: &str,
    app_id: &str,
    version: &str,
    exe_path: &str,
) -> Result<WinRegistryStatus, String> {
    let exe = Path::new(exe_path);
    let exe_dir = exe
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    let exe_name = exe
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("SZXmusic.exe");

    // 1. Software\{app_name} & Capabilities & RegisteredApplications
    let app_key = format!("Software\\{app_name}");
    let cap_key = format!("{app_key}\\Capabilities");
    let url_assoc_key = format!("{cap_key}\\URLAssociations");
    set_hkcu_sz(&app_key, None, app_name)?;
    set_hkcu_sz(&app_key, Some("InstallPath"), &exe_dir)?;
    set_hkcu_sz(&app_key, Some("ExePath"), exe_path)?;
    set_hkcu_sz(&app_key, Some("Version"), version)?;
    set_hkcu_sz(&app_key, Some("AppUserModelId"), app_id)?;
    set_hkcu_sz(&cap_key, Some("ApplicationName"), app_name)?;
    set_hkcu_sz(
        &cap_key,
        Some("ApplicationDescription"),
        "SZXmusic · B站黑胶唱片箱桌面音乐播放器",
    )?;
    set_hkcu_sz(&url_assoc_key, Some(protocol), &format!("{app_name}.{protocol}"))?;
    set_hkcu_sz(HKCU_REGISTERED_APPS, Some(app_name), &cap_key)?;

    // 2. App Paths
    let app_paths_key = format!("{HKCU_APP_PATHS_PREFIX}\\{exe_name}");
    set_hkcu_sz(&app_paths_key, None, exe_path)?;
    if !exe_dir.is_empty() {
        set_hkcu_sz(&app_paths_key, Some("Path"), &exe_dir)?;
    }

    // 3. URL Protocol Handler (`{protocol}://`)
    let proto_key = format!("Software\\Classes\\{protocol}");
    let proto_icon_key = format!("{proto_key}\\DefaultIcon");
    let proto_cmd_key = format!("{proto_key}\\shell\\open\\command");
    set_hkcu_sz(&proto_key, None, &format!("URL:{app_name} Protocol"))?;
    set_hkcu_sz(&proto_key, Some("URL Protocol"), "")?;
    set_hkcu_sz(&proto_icon_key, None, &format!("\"{exe_path}\",0"))?;
    set_hkcu_sz(&proto_cmd_key, None, &format!("\"{exe_path}\" \"%1\""))?;

    // Refresh HKCU Run path if autostart is already turned on (handles portable folder relocation)
    if is_windows_autostart_enabled(app_name) {
        let _ = set_windows_autostart(true, app_name, exe_path);
    }

    Ok(get_windows_registry_status(app_name, protocol, exe_path))
}

/// Unregisters all user-scope Windows registry entries for the application.
pub fn unregister_windows_app(
    app_name: &str,
    protocol: &str,
    exe_path: &str,
) -> Result<WinRegistryStatus, String> {
    let exe_name = Path::new(exe_path)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("SZXmusic.exe");

    let _ = delete_hkcu_value(HKCU_RUN_KEY, app_name);
    let _ = delete_hkcu_value(HKCU_REGISTERED_APPS, app_name);
    let _ = delete_hkcu_tree(&format!("Software\\{app_name}"));
    let _ = delete_hkcu_tree(&format!("Software\\Classes\\{protocol}"));
    let _ = delete_hkcu_tree(&format!("{HKCU_APP_PATHS_PREFIX}\\{exe_name}"));

    Ok(get_windows_registry_status(app_name, protocol, exe_path))
}

/// Encrypts sensitive session bytes using Windows DPAPI tied to the current OS user.
pub fn dpapi_protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    if plain.is_empty() {
        return Ok(Vec::new());
    }
    let mut in_buf = plain.to_vec();
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: in_buf.len() as u32,
        pbData: in_buf.as_mut_ptr(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptProtectData(
            &in_blob,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };
    if ok.is_err() || out_blob.pbData.is_null() {
        return Err(format!("DPAPI 加密失败: {ok:?}"));
    }
    let cipher = unsafe {
        std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
    };
    unsafe {
        let _ = LocalFree(HLOCAL(out_blob.pbData.cast()));
    }
    Ok(cipher)
}

/// Decrypts Windows DPAPI bytes protected for the current OS user.
pub fn dpapi_unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
    if cipher.is_empty() {
        return Ok(Vec::new());
    }
    let mut in_buf = cipher.to_vec();
    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: in_buf.len() as u32,
        pbData: in_buf.as_mut_ptr(),
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptUnprotectData(
            &in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };
    if ok.is_err() || out_blob.pbData.is_null() {
        return Err(format!("DPAPI 解密失败: {ok:?}"));
    }
    let plain = unsafe {
        std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
    };
    unsafe {
        let _ = LocalFree(HLOCAL(out_blob.pbData.cast()));
    }
    Ok(plain)
}

/// Advises Windows memory manager to trim unused working set pages from the host process
/// after freeing large audio decode buffers or hiding windows to background.
pub fn trim_process_working_set() {
    unsafe {
        let proc_handle = GetCurrentProcess();
        let _ = SetProcessWorkingSetSize(proc_handle, usize::MAX, usize::MAX);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_lifecycle_and_autostart_roundtrip() {
        let app = "SZXmusic_UnitTest_Reg";
        let proto = "szxmusictest";
        let exe = "C:\\Program Files\\SZXmusic\\SZXmusic.exe";

        // Start clean
        let _ = unregister_windows_app(app, proto, exe);

        let st = register_windows_app(app, proto, "com.szxmusic.test", "0.1.0", exe)
            .expect("register app");
        assert!(st.app_registered);
        assert!(st.protocol_registered);
        assert!(st.app_paths_registered);
        assert!(!st.autostart);

        set_windows_autostart(true, app, exe).expect("enable autostart");
        assert!(is_windows_autostart_enabled(app));

        let st2 = get_windows_registry_status(app, proto, exe);
        assert!(st2.autostart);
        assert!(st2.app_registered);
        assert!(st2.protocol_registered);
        assert!(st2.app_paths_registered);

        let st3 = unregister_windows_app(app, proto, exe).expect("unregister app");
        assert!(!st3.autostart);
        assert!(!st3.app_registered);
        assert!(!st3.protocol_registered);
        assert!(!st3.app_paths_registered);
    }
}
