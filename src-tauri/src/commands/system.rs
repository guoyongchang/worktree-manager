use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::Duration;

use serde::Serialize;
use wait_timeout::ChildExt;

use crate::types::OpenEditorRequest;
use crate::utils::{friendly_io_error, normalize_path};
use crate::{pending_crash_report, CrashReport};

const TOOL_DETECTION_TIMEOUT_SECS: u64 = 10;

// ==================== Tauri 命令：工具 ====================

#[tauri::command]
pub(crate) fn get_crash_report() -> Option<CrashReport> {
    match pending_crash_report().lock() {
        Ok(mut pending) => pending.take(),
        Err(e) => {
            log::error!("[crash] failed to lock pending crash report: {}", e);
            None
        }
    }
}

fn command_for_log(cmd: &Command) -> String {
    let mut parts = Vec::new();
    parts.push(cmd.get_program().to_string_lossy().to_string());
    parts.extend(cmd.get_args().map(|arg| arg.to_string_lossy().to_string()));
    parts.join(" ")
}

#[cfg(target_os = "windows")]
fn hide_command_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

fn output_with_timeout(cmd: &mut Command, timeout_secs: u64) -> Option<Output> {
    use std::io::Read;

    let command = command_for_log(cmd);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            log::warn!("[system] Failed to spawn '{}': {}", command, e);
            return None;
        }
    };

    match child.wait_timeout(Duration::from_secs(timeout_secs)) {
        Ok(Some(status)) => {
            let mut stdout = Vec::new();
            if let Some(mut pipe) = child.stdout.take() {
                if let Err(e) = pipe.read_to_end(&mut stdout) {
                    log::warn!("[system] Failed to read stdout from '{}': {}", command, e);
                    return None;
                }
            }

            let mut stderr = Vec::new();
            if let Some(mut pipe) = child.stderr.take() {
                if let Err(e) = pipe.read_to_end(&mut stderr) {
                    log::warn!("[system] Failed to read stderr from '{}': {}", command, e);
                    return None;
                }
            }

            Some(Output {
                status,
                stdout,
                stderr,
            })
        }
        Ok(None) => {
            log::warn!(
                "[system] Command timed out after {}s: {}",
                timeout_secs,
                command
            );
            let _ = child.kill();
            let _ = child.wait();
            None
        }
        Err(e) => {
            log::warn!("[system] Failed while waiting for '{}': {}", command, e);
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, PartialEq, Eq)]
struct WindowsTerminalLaunch {
    program: String,
    args: Vec<String>,
    current_dir: Option<PathBuf>,
}

#[cfg(any(target_os = "windows", test))]
fn path_like_executable(value: &str) -> bool {
    std::path::Path::new(value).is_absolute() || value.contains('\\') || value.contains('/')
}

#[cfg(any(target_os = "windows", test))]
fn git_bash_shell_path() -> String {
    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return path.to_string();
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let path = format!(r"{}\Programs\Git\bin\bash.exe", local);
        if std::path::Path::new(&path).exists() {
            return path;
        }
    }
    "bash.exe".to_string()
}

#[cfg(any(target_os = "windows", test))]
fn windows_shell_command(shell: Option<&str>) -> Vec<String> {
    let shell = shell
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "auto");
    match shell {
        Some("cmd") => vec!["cmd.exe".to_string()],
        Some("powershell") => vec!["powershell.exe".to_string()],
        Some("pwsh") => vec!["pwsh.exe".to_string()],
        Some("gitbash") | Some("bash") => {
            vec![
                git_bash_shell_path(),
                "--login".to_string(),
                "-i".to_string(),
            ]
        }
        Some("nu") => vec!["nu.exe".to_string()],
        Some(other) if path_like_executable(other) => vec![other.to_string()],
        _ => Vec::new(),
    }
}

#[cfg(any(target_os = "windows", test))]
fn build_windows_terminal_launch(
    normalized_path: &str,
    terminal: Option<&str>,
    shell: Option<&str>,
) -> WindowsTerminalLaunch {
    let term = terminal
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("auto");

    match term {
        "cmd" => WindowsTerminalLaunch {
            program: "cmd".to_string(),
            args: vec![
                "/c".to_string(),
                "start".to_string(),
                "cmd".to_string(),
                "/k".to_string(),
                format!("cd /d {}", normalized_path),
            ],
            current_dir: None,
        },
        "powershell" => WindowsTerminalLaunch {
            program: "cmd".to_string(),
            args: vec![
                "/c".to_string(),
                "start".to_string(),
                "powershell".to_string(),
                "-NoExit".to_string(),
                "-Command".to_string(),
                format!("Set-Location '{}'", normalized_path),
            ],
            current_dir: None,
        },
        "windowsterminal" | "auto" => {
            let mut args = vec!["-d".to_string(), normalized_path.to_string()];
            args.extend(windows_shell_command(shell));
            WindowsTerminalLaunch {
                program: "wt".to_string(),
                args,
                current_dir: None,
            }
        }
        "gitbash" => {
            let candidates = [
                r"C:\Program Files\Git\git-bash.exe",
                r"C:\Program Files (x86)\Git\git-bash.exe",
            ];
            let mut git_bash_path: Option<String> = None;
            for path in &candidates {
                if std::path::Path::new(path).exists() {
                    git_bash_path = Some(path.to_string());
                    break;
                }
            }
            if git_bash_path.is_none() {
                if let Ok(local) = std::env::var("LOCALAPPDATA") {
                    let path = format!(r"{}\Programs\Git\git-bash.exe", local);
                    if std::path::Path::new(&path).exists() {
                        git_bash_path = Some(path);
                    }
                }
            }
            WindowsTerminalLaunch {
                program: git_bash_path.unwrap_or_else(|| "git-bash.exe".to_string()),
                args: vec![format!("--cd={}", normalized_path)],
                current_dir: None,
            }
        }
        other => WindowsTerminalLaunch {
            program: other.to_string(),
            args: Vec::new(),
            current_dir: Some(PathBuf::from(normalized_path)),
        },
    }
}

#[cfg(target_os = "windows")]
fn spawn_windows_terminal_launch(
    launch: &WindowsTerminalLaunch,
    create_no_window: u32,
) -> std::io::Result<std::process::Child> {
    use std::os::windows::process::CommandExt;

    let mut command = Command::new(&launch.program);
    command.args(&launch.args).creation_flags(create_no_window);
    if let Some(dir) = &launch.current_dir {
        command.current_dir(dir);
    }
    command.spawn()
}

#[tauri::command]
pub(crate) fn open_in_terminal(
    path: String,
    terminal: Option<String>,
    shell: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_path(&path);
    let term = terminal.as_deref().unwrap_or("auto");
    log::info!(
        "[system] Opening terminal at: {} (type: {}, shell: {:?})",
        normalized,
        term,
        shell
    );

    #[cfg(target_os = "macos")]
    {
        let app_name = match term {
            "iterm2" => "iTerm",
            "warp" => "Warp",
            "alacritty" => "Alacritty",
            "kitty" => "kitty",
            "ghostty" => "Ghostty",
            _ => "Terminal", // "terminal", "auto", or unknown
        };
        match Command::new("open")
            .args(["-a", app_name, &normalized])
            .spawn()
        {
            Ok(_) => log::info!("[system] Spawned {} for: {}", app_name, normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn {}: {}", app_name, e);
                return Err(format!(
                    "无法打开终端 {}：{}",
                    app_name,
                    friendly_io_error(&e)
                ));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let launch =
            build_windows_terminal_launch(&normalized, terminal.as_deref(), shell.as_deref());
        log::info!("[system] Windows terminal launch plan: {:?}", launch);
        let mut result = spawn_windows_terminal_launch(&launch, CREATE_NO_WINDOW);
        if result.is_err() && term == "auto" {
            let fallback = build_windows_terminal_launch(&normalized, Some("cmd"), None);
            log::warn!(
                "[system] Auto terminal launch failed; falling back to: {:?}",
                fallback
            );
            result = spawn_windows_terminal_launch(&fallback, CREATE_NO_WINDOW);
        }

        match result {
            Ok(_) => log::info!("[system] Spawned terminal '{}' for: {}", term, normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn terminal '{}': {}", term, e);
                return Err(format!("无法打开终端：{}", friendly_io_error(&e)));
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
        let mut opened = false;
        for t in &terminals {
            let result = if *t == "gnome-terminal" {
                Command::new(t)
                    .args(["--working-directory", &normalized])
                    .spawn()
            } else {
                Command::new(t).current_dir(&normalized).spawn()
            };
            if result.is_ok() {
                log::info!("[system] Spawned {} for: {}", t, normalized);
                opened = true;
                break;
            }
        }
        if !opened {
            log::error!("[system] No terminal emulator found on Linux");
            return Err("No terminal emulator found".to_string());
        }
    }

    Ok(())
}

fn editor_cli_command(editor: &str) -> &'static str {
    match editor {
        "vscode" => "code",
        "cursor" => "cursor",
        "antigravity" => "antigravity",
        "idea" => "idea",
        "codex" => "codex",
        _ => "code",
    }
}

#[cfg(target_os = "macos")]
fn editor_app_name(editor: &str) -> &'static str {
    match editor {
        "vscode" => "Visual Studio Code",
        "cursor" => "Cursor",
        "antigravity" => "Antigravity",
        "idea" => "IntelliJ IDEA",
        "codex" => "Codex",
        _ => "Visual Studio Code",
    }
}

pub(crate) fn open_editor_at_path(
    request: &OpenEditorRequest,
    custom_path: Option<&str>,
) -> Result<(), String> {
    let path = &request.path;
    log::info!(
        "[system] Opening editor: type={}, path={}, custom={:?}",
        request.editor,
        path,
        custom_path
    );

    // If custom path is provided, use it directly
    if let Some(exe) = custom_path {
        if !exe.is_empty() {
            // On macOS, .app bundles need to be opened via `open -a`
            #[cfg(target_os = "macos")]
            if exe.ends_with(".app") {
                match Command::new("open").args(["-a", exe, path]).spawn() {
                    Ok(_) => {
                        log::info!(
                            "[system] Spawned custom editor via open -a '{}' for: {}",
                            exe,
                            path
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        log::error!("[system] Failed to open editor app '{}': {}", exe, e);
                        return Err(format!("无法打开编辑器 {}：{}", exe, friendly_io_error(&e)));
                    }
                }
            }
            // Codex uses subcommand: `codex app <path>`
            // First invocation launches the app; after a delay, second invocation opens the path.
            let spawn_result = if request.editor == "codex" {
                Command::new(exe).args(["app", path]).spawn()
            } else {
                Command::new(exe).arg(path).spawn()
            };
            match spawn_result {
                Ok(_) => {
                    log::info!("[system] Spawned custom editor '{}' for: {}", exe, path);
                    if request.editor == "codex" {
                        let exe_owned = exe.to_string();
                        let path_owned = path.to_string();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(3));
                            let _ = Command::new(&exe_owned).args(["app", &path_owned]).spawn();
                        });
                    }
                    return Ok(());
                }
                Err(e) => {
                    log::error!("[system] Failed to spawn custom editor '{}': {}", exe, e);
                    return Err(format!("无法打开编辑器 {}：{}", exe, friendly_io_error(&e)));
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Codex uses subcommand: `codex app <path>`
        // First invocation launches the app; after a delay, second invocation opens the path.
        if request.editor == "codex" {
            let cmd = editor_cli_command(&request.editor);
            match Command::new(cmd).args(["app", path]).spawn() {
                Ok(_) => {
                    log::info!("[system] Spawned {} app (1st, launch) for: {}", cmd, path);
                    // Spawn background thread to send the command again after the app starts
                    let path_owned = path.to_string();
                    let cmd_owned = cmd.to_string();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        match Command::new(&cmd_owned).args(["app", &path_owned]).spawn() {
                            Ok(_) => log::info!("[system] Spawned {} app (2nd, open path) for: {}", cmd_owned, path_owned),
                            Err(e) => log::warn!("[system] Codex 2nd invocation failed (app may already have the path): {}", e),
                        }
                    });
                    return Ok(());
                }
                Err(e) => {
                    log::error!("[system] Failed to spawn codex: {}", e);
                    return Err(format!(
                        "无法打开 Codex，请确认已安装该编辑器：{}",
                        friendly_io_error(&e)
                    ));
                }
            }
        }
        let app_name = editor_app_name(&request.editor);
        if Command::new("open")
            .args(["-a", app_name, path])
            .spawn()
            .is_ok()
        {
            log::info!("[system] Spawned {} via open -a for: {}", app_name, path);
            return Ok(());
        }
        let cmd = editor_cli_command(&request.editor);
        match Command::new(cmd).arg(path).spawn() {
            Ok(_) => {
                log::info!("[system] Spawned {} CLI for: {}", cmd, path);
            }
            Err(e) => {
                log::error!("[system] Failed to spawn editor process: {}", e);
                return Err(format!("无法打开 {}，请确认已安装该编辑器", app_name));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let cmd = editor_cli_command(&request.editor);
        if request.editor == "codex" {
            // Windows: Codex is a UWP app, launch via shell:AppsFolder
            let aumid = r"OpenAI.Codex_2p2nqsd0c76g0!App";
            match Command::new("explorer")
                .arg(format!(r"shell:AppsFolder\{}", aumid))
                .spawn()
            {
                Ok(_) => log::info!("[system] Launched Codex UWP app"),
                Err(e) => {
                    log::error!("[system] Failed to launch Codex UWP: {}", e);
                    return Err(format!("无法打开 Codex：{}", friendly_io_error(&e)));
                }
            }
        } else {
            match Command::new(cmd).arg(path).spawn() {
                Ok(_) => {
                    log::info!("[system] Spawned {} for: {}", cmd, path);
                }
                Err(e) => {
                    log::error!("[system] Failed to spawn editor process: {}", e);
                    return Err(format!("无法打开编辑器 {}：{}", cmd, friendly_io_error(&e)));
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let cmd = editor_cli_command(&request.editor);
        // Codex uses subcommand: `codex app <path>`
        let spawn_result = if request.editor == "codex" {
            Command::new(cmd).args(["app", path]).spawn()
        } else {
            Command::new(cmd).arg(path).spawn()
        };
        match spawn_result {
            Ok(_) => {
                log::info!("[system] Spawned {} for: {}", cmd, path);
                if request.editor == "codex" {
                    let path_owned = path.to_string();
                    let cmd_owned = cmd.to_string();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        let _ = Command::new(&cmd_owned).args(["app", &path_owned]).spawn();
                    });
                }
            }
            Err(e) => {
                log::error!("[system] Failed to spawn editor process: {}", e);
                return Err(format!("无法打开编辑器 {}：{}", cmd, friendly_io_error(&e)));
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn open_in_editor(
    request: OpenEditorRequest,
    custom_path: Option<String>,
) -> Result<(), String> {
    open_editor_at_path(&request, custom_path.as_deref())
}

#[tauri::command]
pub(crate) fn reveal_in_finder(path: String) -> Result<(), String> {
    let normalized = normalize_path(&path);
    log::info!("[system] Revealing in file manager: {}", normalized);

    #[cfg(target_os = "macos")]
    {
        match Command::new("open").arg(&normalized).spawn() {
            Ok(_) => log::info!("[system] Spawned Finder for: {}", normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn Finder: {}", e);
                return Err(format!("无法打开文件夹：{}", friendly_io_error(&e)));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        match Command::new("explorer").arg(&normalized).spawn() {
            Ok(_) => log::info!("[system] Spawned Explorer for: {}", normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn Explorer: {}", e);
                return Err(format!("无法打开文件夹：{}", friendly_io_error(&e)));
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        match Command::new("xdg-open").arg(&normalized).spawn() {
            Ok(_) => log::info!("[system] Spawned xdg-open for: {}", normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn xdg-open: {}", e);
                return Err(format!("无法打开文件夹：{}", friendly_io_error(&e)));
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn open_log_dir() -> Result<(), String> {
    let log_dir = get_platform_log_dir()?;
    log::info!("[system] Opening log directory: {:?}", log_dir);

    if !log_dir.exists() {
        log::info!(
            "[system] Log directory does not exist, creating: {:?}",
            log_dir
        );
        std::fs::create_dir_all(&log_dir)
            .map_err(|e| format!("无法创建日志目录：{}", friendly_io_error(&e)))?;
    }

    let dir_str = log_dir.to_str().unwrap_or("");

    #[cfg(target_os = "macos")]
    {
        match Command::new("open").arg(dir_str).spawn() {
            Ok(_) => log::info!("[system] Spawned Finder for log directory"),
            Err(e) => {
                log::error!("[system] Failed to open log directory: {}", e);
                return Err(format!("无法打开日志目录：{}", friendly_io_error(&e)));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        match Command::new("explorer").arg(dir_str).spawn() {
            Ok(_) => log::info!("[system] Spawned Explorer for log directory"),
            Err(e) => {
                log::error!("[system] Failed to open log directory: {}", e);
                return Err(format!("无法打开日志目录：{}", friendly_io_error(&e)));
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        match Command::new("xdg-open").arg(dir_str).spawn() {
            Ok(_) => log::info!("[system] Spawned xdg-open for log directory"),
            Err(e) => {
                log::error!("[system] Failed to open log directory: {}", e);
                return Err(format!("无法打开日志目录：{}", friendly_io_error(&e)));
            }
        }
    }

    Ok(())
}

/// Extract the icon of an app/exe as a base64 data URL.
#[tauri::command]
#[allow(unused_variables)]
pub(crate) fn get_app_icon(path: String) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        return extract_macos_app_icon(&path);
    }
    #[cfg(target_os = "windows")]
    {
        let icon_map = extract_windows_exe_icons_batch(std::slice::from_ref(&path));
        return icon_map
            .get(&path)
            .filter(|s| !s.is_empty())
            .map(|b64| format!("data:image/png;base64,{}", b64));
    }
    #[allow(unreachable_code)]
    None
}

/// Get the platform-appropriate log directory.
fn get_platform_log_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "无法获取用户目录".to_string())?;
        Ok(PathBuf::from(home).join("Library/Logs/com.guo.worktree-manager"))
    }
    #[cfg(target_os = "windows")]
    {
        // Tauri on Windows logs to %LOCALAPPDATA%/{identifier}/logs
        let appdata = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("APPDATA"))
            .map_err(|_| "无法获取 LOCALAPPDATA 目录".to_string())?;
        Ok(PathBuf::from(appdata)
            .join("com.guo.worktree-manager")
            .join("logs"))
    }
    #[cfg(target_os = "linux")]
    {
        // Tauri on Linux logs to $XDG_DATA_HOME/{identifier}/logs or ~/.local/share/...
        let data_home = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_default();
            format!("{}/.local/share", home)
        });
        Ok(PathBuf::from(data_home)
            .join("com.guo.worktree-manager")
            .join("logs"))
    }
}

// ==================== App Icon Extraction ====================

/// Extract the app icon from a macOS .app bundle and return as base64 data URL.
/// Reads Info.plist → CFBundleIconFile → converts .icns to 32x32 PNG → base64.
#[cfg(target_os = "macos")]
fn extract_macos_app_icon(app_path: &str) -> Option<String> {
    use std::process::Command;

    let app = std::path::Path::new(app_path);
    if !app.exists() {
        return None;
    }

    // Step 1: Read CFBundleIconFile from Info.plist
    let plist_output = Command::new("/usr/bin/defaults")
        .arg("read")
        .arg(
            app.join("Contents/Info.plist")
                .to_string_lossy()
                .to_string(),
        )
        .arg("CFBundleIconFile")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !plist_output.status.success() {
        return None;
    }

    let mut icon_file = String::from_utf8_lossy(&plist_output.stdout)
        .trim()
        .to_string();
    if icon_file.is_empty() {
        return None;
    }

    // Ensure .icns extension
    if !icon_file.ends_with(".icns") {
        icon_file.push_str(".icns");
    }

    let icns_path = app.join("Contents/Resources").join(&icon_file);
    if !icns_path.exists() {
        return None;
    }

    // Step 2: Convert .icns to 32x32 PNG using sips
    let tmp_png = format!(
        "/tmp/wm_icon_{}.png",
        app.file_name()?.to_string_lossy().replace(' ', "_")
    );
    let sips_output = Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(icns_path.to_string_lossy().to_string())
        .args(["--out", &tmp_png])
        .args(["--resampleWidth", "256"])
        .args(["-z", "256", "256"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !sips_output.status.success() {
        return None;
    }

    // Step 3: Read PNG and base64 encode
    let png_data = std::fs::read(&tmp_png).ok()?;
    // Clean up temp file
    let _ = std::fs::remove_file(&tmp_png);

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_data);
    Some(format!("data:image/png;base64,{}", b64))
}

/// Batch-extract icons from multiple Windows .exe files.
/// Returns a map of exe_path → base64 PNG data.
#[cfg(target_os = "windows")]
fn extract_windows_exe_icons_batch(paths: &[String]) -> std::collections::HashMap<String, String> {
    let mut result = std::collections::HashMap::new();
    for path in paths {
        match windows_icons::get_icon_base64_by_path(path) {
            Ok(b64) if !b64.is_empty() => {
                result.insert(path.clone(), b64);
            }
            Ok(_) => {
                log::warn!("[system] Icon extraction returned empty for: {}", path);
            }
            Err(e) => {
                log::warn!("[system] Icon extraction failed for {}: {}", path, e);
            }
        }
    }
    log::debug!(
        "[system] Icon extraction succeeded for {}/{} paths",
        result.len(),
        paths.len()
    );
    result
}
// ==================== Tool Detection ====================

#[derive(Debug, Clone, Serialize, Default)]
pub struct DetectedTool {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DetectedTools {
    pub git: Vec<DetectedTool>,
    pub terminals: Vec<DetectedTool>,
    pub editors: Vec<DetectedTool>,
    pub shells: Vec<DetectedTool>,
}

fn check_executable(name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("where");
        command
            .arg(name)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        hide_command_window(&mut command);
        let output = output_with_timeout(&mut command, TOOL_DETECTION_TIMEOUT_SECS)?;
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            return s.lines().next().map(|l| l.trim().to_string());
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut command = Command::new("/usr/bin/which");
        command
            .arg(name)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let output = output_with_timeout(&mut command, TOOL_DETECTION_TIMEOUT_SECS)?;
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            return s.lines().next().map(|l| l.trim().to_string());
        }
        None
    }
}

fn detect_git() -> Vec<DetectedTool> {
    let mut results = Vec::new();

    if let Some(path) = check_executable("git") {
        results.push(DetectedTool {
            id: "git".into(),
            name: "Git".into(),
            path,
            icon: None,
        });
    }

    #[cfg(target_os = "windows")]
    {
        let candidates = [
            (r"C:\Program Files\Git\cmd\git.exe", "Git (Program Files)"),
            (r"C:\Program Files (x86)\Git\cmd\git.exe", "Git (x86)"),
        ];
        for (p, name) in &candidates {
            if std::path::Path::new(p).exists() && !results.iter().any(|r| r.path == *p) {
                results.push(DetectedTool {
                    id: "git".into(),
                    name: name.to_string(),
                    path: p.to_string(),
                    icon: None,
                });
            }
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let p = format!(r"{}\Programs\Git\cmd\git.exe", local);
            if std::path::Path::new(&p).exists() && !results.iter().any(|r| r.path == p) {
                results.push(DetectedTool {
                    id: "git".into(),
                    name: "Git (User)".into(),
                    path: p,
                    icon: None,
                });
            }
        }
    }

    results
}

fn detect_terminals() -> Vec<DetectedTool> {
    let mut results = Vec::new();

    #[cfg(target_os = "macos")]
    {
        results.push(DetectedTool {
            id: "terminal".into(),
            name: "Terminal.app".into(),
            path: "/System/Applications/Utilities/Terminal.app".into(),
            icon: None,
        });
        if std::path::Path::new("/Applications/iTerm.app").exists() {
            results.push(DetectedTool {
                id: "iterm2".into(),
                name: "iTerm2".into(),
                path: "/Applications/iTerm.app".into(),
                icon: None,
            });
        }
        if std::path::Path::new("/Applications/Warp.app").exists() {
            results.push(DetectedTool {
                id: "warp".into(),
                name: "Warp".into(),
                path: "/Applications/Warp.app".into(),
                icon: None,
            });
        }
        if std::path::Path::new("/Applications/Alacritty.app").exists() {
            results.push(DetectedTool {
                id: "alacritty".into(),
                name: "Alacritty".into(),
                path: "/Applications/Alacritty.app".into(),
                icon: None,
            });
        }
        if std::path::Path::new("/Applications/kitty.app").exists() {
            results.push(DetectedTool {
                id: "kitty".into(),
                name: "kitty".into(),
                path: "/Applications/kitty.app".into(),
                icon: None,
            });
        }
        if std::path::Path::new("/Applications/Ghostty.app").exists() {
            results.push(DetectedTool {
                id: "ghostty".into(),
                name: "Ghostty".into(),
                path: "/Applications/Ghostty.app".into(),
                icon: None,
            });
        }
    }

    #[cfg(target_os = "windows")]
    {
        results.push(DetectedTool {
            id: "cmd".into(),
            name: "CMD".into(),
            path: "cmd.exe".into(),
            icon: None,
        });
        results.push(DetectedTool {
            id: "powershell".into(),
            name: "PowerShell".into(),
            path: "powershell.exe".into(),
            icon: None,
        });
        if check_executable("wt").is_some() {
            results.push(DetectedTool {
                id: "windowsterminal".into(),
                name: "Windows Terminal".into(),
                path: "wt.exe".into(),
                icon: None,
            });
        }
        // Git Bash terminal — keep in sync with build_windows_terminal_launch() in this file.
        let mut gitbash_terminal_found = false;
        let git_bash_terminal_candidates = [
            r"C:\Program Files\Git\git-bash.exe",
            r"C:\Program Files (x86)\Git\git-bash.exe",
        ];
        for p in &git_bash_terminal_candidates {
            if std::path::Path::new(p).exists() {
                results.push(DetectedTool {
                    id: "gitbash".into(),
                    name: "Git Bash".into(),
                    path: p.to_string(),
                    icon: None,
                });
                gitbash_terminal_found = true;
                break;
            }
        }
        if !gitbash_terminal_found {
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                let p = format!(r"{}\Programs\Git\git-bash.exe", local);
                if std::path::Path::new(&p).exists() {
                    results.push(DetectedTool {
                        id: "gitbash".into(),
                        name: "Git Bash".into(),
                        path: p,
                        icon: None,
                    });
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let terminals = [
            ("gnome-terminal", "GNOME Terminal"),
            ("konsole", "Konsole"),
            ("xfce4-terminal", "XFCE Terminal"),
            ("xterm", "XTerm"),
            ("alacritty", "Alacritty"),
            ("kitty", "kitty"),
            ("ghostty", "Ghostty"),
            ("wezterm", "WezTerm"),
            ("tilix", "Tilix"),
        ];
        for (cmd, name) in &terminals {
            if let Some(path) = check_executable(cmd) {
                results.push(DetectedTool {
                    id: cmd.to_string(),
                    name: name.to_string(),
                    path,
                    icon: None,
                });
            }
        }
    }

    // Extract icons — same pattern as detect_editors()
    #[cfg(target_os = "macos")]
    for tool in results.iter_mut() {
        if tool.icon.is_none() && tool.path.ends_with(".app") {
            tool.icon = extract_macos_app_icon(&tool.path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let exe_paths: Vec<String> = results
            .iter()
            .filter(|t| t.icon.is_none() && t.path.to_ascii_lowercase().ends_with(".exe"))
            .map(|t| t.path.clone())
            .collect();
        if !exe_paths.is_empty() {
            let icon_map = extract_windows_exe_icons_batch(&exe_paths);
            for tool in results.iter_mut() {
                if tool.icon.is_none() {
                    if let Some(b64) = icon_map.get(&tool.path) {
                        if !b64.is_empty() {
                            tool.icon = Some(format!("data:image/png;base64,{}", b64));
                        }
                    }
                }
            }
        }
    }

    results
}

/// Query Windows registry (HKLM + HKCU uninstall keys) for installed editors.
/// Returns actual .exe paths, enabling correct icon extraction.
#[cfg(target_os = "windows")]
fn detect_editors_via_registry() -> Vec<DetectedTool> {
    // Each entry: (display_name_substring, id, friendly_name, exe_relative_to_InstallLocation)
    // Paths use Windows backslash. Pattern matching is case-insensitive (-like).
    let ps_script = r#"
$editors = @(
    [pscustomobject]@{P='Microsoft Visual Studio Code';Id='vscode';N='VS Code';E='Code.exe'},
    [pscustomobject]@{P='Visual Studio Code - Insiders';Id='vscode-insiders';N='VS Code Insiders';E='Code - Insiders.exe'},
    [pscustomobject]@{P='VSCodium';Id='vscodium';N='VSCodium';E='VSCodium.exe'},
    [pscustomobject]@{P='Cursor';Id='cursor';N='Cursor';E='Cursor.exe'},
    [pscustomobject]@{P='Windsurf';Id='windsurf';N='Windsurf';E='Windsurf.exe'},
    [pscustomobject]@{P='Trae';Id='trae';N='Trae';E='Trae.exe'},
    [pscustomobject]@{P='Antigravity';Id='antigravity';N='Antigravity';E='Antigravity.exe'},
    [pscustomobject]@{P='IntelliJ IDEA';Id='idea';N='IntelliJ IDEA';E='bin\idea64.exe'},
    [pscustomobject]@{P='WebStorm';Id='webstorm';N='WebStorm';E='bin\webstorm64.exe'},
    [pscustomobject]@{P='PyCharm';Id='pycharm';N='PyCharm';E='bin\pycharm64.exe'},
    [pscustomobject]@{P='GoLand';Id='goland';N='GoLand';E='bin\goland64.exe'},
    [pscustomobject]@{P='Rider';Id='rider';N='Rider';E='bin\rider64.exe'},
    [pscustomobject]@{P='CLion';Id='clion';N='CLion';E='bin\clion64.exe'},
    [pscustomobject]@{P='RustRover';Id='rustrover';N='RustRover';E='bin\rustrover64.exe'},
    [pscustomobject]@{P='Fleet';Id='fleet';N='Fleet';E='bin\Fleet.exe'},
    [pscustomobject]@{P='DataGrip';Id='datagrip';N='DataGrip';E='bin\datagrip64.exe'},
    [pscustomobject]@{P='PhpStorm';Id='phpstorm';N='PhpStorm';E='bin\phpstorm64.exe'},
    [pscustomobject]@{P='Android Studio';Id='android-studio';N='Android Studio';E='bin\studio64.exe'},
    [pscustomobject]@{P='Sublime Text';Id='sublime';N='Sublime Text';E='sublime_text.exe'},
    [pscustomobject]@{P='Zed';Id='zed';N='Zed';E='zed.exe'}
)
$found = @{}
$regPaths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($rp in $regPaths) {
    if (-not (Test-Path $rp)) { continue }
    Get-ChildItem $rp -ErrorAction SilentlyContinue | ForEach-Object {
        $app = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        if (-not $app -or -not $app.DisplayName -or -not $app.InstallLocation) { return }
        foreach ($ed in $editors) {
            if ($found.ContainsKey($ed.Id)) { continue }
            if ($app.DisplayName -like "*$($ed.P)*") {
                $exePath = Join-Path $app.InstallLocation $ed.E
                if (Test-Path $exePath) {
                    $found[$ed.Id] = [pscustomobject]@{id=$ed.Id;name=$ed.N;path=$exePath}
                }
            }
        }
    }
}
$result = @($found.Values)
if ($result.Count -gt 0) { ConvertTo-Json -InputObject $result -Compress } else { Write-Output '[]' }
"#;

    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    hide_command_window(&mut command);
    let output = match output_with_timeout(&mut command, TOOL_DETECTION_TIMEOUT_SECS) {
        Some(output) => output,
        None => {
            log::warn!("[system] Registry editor scan failed or timed out");
            return Vec::new();
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() || trimmed == "null" || trimmed == "[]" {
        return Vec::new();
    }

    #[derive(serde::Deserialize)]
    struct RegEntry {
        id: String,
        name: String,
        path: String,
    }

    // ConvertTo-Json may emit an object (not array) when count == 1; handle both
    let entries: Vec<RegEntry> = serde_json::from_str(trimmed)
        .or_else(|_| serde_json::from_str::<RegEntry>(trimmed).map(|r| vec![r]))
        .unwrap_or_default();

    entries
        .into_iter()
        .map(|r| DetectedTool {
            id: r.id,
            name: r.name,
            path: r.path,
            icon: None,
        })
        .collect()
}

fn detect_editors() -> Vec<DetectedTool> {
    let mut results = Vec::new();

    #[cfg(not(target_os = "windows"))]
    let editors: &[(&str, &str, &str)] = &[
        ("code", "vscode", "Visual Studio Code"),
        ("cursor", "cursor", "Cursor"),
        ("antigravity", "antigravity", "Antigravity"),
        ("idea", "idea", "IntelliJ IDEA"),
        ("codex", "codex", "Codex"),
        ("zed", "zed", "Zed"),
        ("sublime_text", "sublime", "Sublime Text"),
    ];

    #[cfg(not(target_os = "windows"))]
    for (cmd, id, name) in editors {
        if let Some(path) = check_executable(cmd) {
            results.push(DetectedTool {
                id: id.to_string(),
                name: name.to_string(),
                path,
                icon: None,
            });
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Comprehensive scan of /Applications for all known IDEs/editors
        let mac_apps: &[(&str, &str, &str)] = &[
            // VS Code family
            ("/Applications/Visual Studio Code.app", "vscode", "VS Code"),
            (
                "/Applications/Visual Studio Code - Insiders.app",
                "vscode-insiders",
                "VS Code Insiders",
            ),
            ("/Applications/VSCodium.app", "vscodium", "VSCodium"),
            // AI-powered editors
            ("/Applications/Cursor.app", "cursor", "Cursor"),
            (
                "/Applications/Antigravity.app",
                "antigravity",
                "Antigravity",
            ),
            ("/Applications/Windsurf.app", "windsurf", "Windsurf"),
            ("/Applications/Trae.app", "trae", "Trae"),
            // JetBrains family
            ("/Applications/IntelliJ IDEA.app", "idea", "IntelliJ IDEA"),
            (
                "/Applications/IntelliJ IDEA CE.app",
                "idea-ce",
                "IntelliJ IDEA CE",
            ),
            ("/Applications/WebStorm.app", "webstorm", "WebStorm"),
            ("/Applications/PyCharm.app", "pycharm", "PyCharm"),
            ("/Applications/PyCharm CE.app", "pycharm-ce", "PyCharm CE"),
            ("/Applications/GoLand.app", "goland", "GoLand"),
            ("/Applications/Rider.app", "rider", "Rider"),
            ("/Applications/CLion.app", "clion", "CLion"),
            ("/Applications/RustRover.app", "rustrover", "RustRover"),
            ("/Applications/Fleet.app", "fleet", "Fleet"),
            ("/Applications/DataGrip.app", "datagrip", "DataGrip"),
            ("/Applications/PhpStorm.app", "phpstorm", "PhpStorm"),
            ("/Applications/Aqua.app", "aqua", "Aqua"),
            // Apple
            ("/Applications/Xcode.app", "xcode", "Xcode"),
            // Google
            (
                "/Applications/Android Studio.app",
                "android-studio",
                "Android Studio",
            ),
            // Other editors
            ("/Applications/Zed.app", "zed", "Zed"),
            ("/Applications/Sublime Text.app", "sublime", "Sublime Text"),
            ("/Applications/Nova.app", "nova", "Nova"),
            ("/Applications/BBEdit.app", "bbedit", "BBEdit"),
            ("/Applications/TextMate.app", "textmate", "TextMate"),
            ("/Applications/CotEditor.app", "coteditor", "CotEditor"),
            ("/Applications/Codex.app", "codex", "Codex"),
        ];
        for (app_path, id, name) in mac_apps {
            if std::path::Path::new(app_path).exists() && !results.iter().any(|r| r.id == *id) {
                let icon = extract_macos_app_icon(app_path);
                results.push(DetectedTool {
                    id: id.to_string(),
                    name: name.to_string(),
                    path: app_path.to_string(),
                    icon,
                });
            }
        }
        // Backfill icons for CLI-detected editors using known .app paths
        let app_lookup: std::collections::HashMap<&str, &str> =
            mac_apps.iter().map(|(path, id, _)| (*id, *path)).collect();
        for tool in results.iter_mut() {
            if tool.icon.is_none() {
                if let Some(app_path) = app_lookup.get(tool.id.as_str()) {
                    if std::path::Path::new(app_path).exists() {
                        tool.icon = extract_macos_app_icon(app_path);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Primary: registry-based detection — handles all install locations (Programs, Toolbox, etc.)
        // and provides actual .exe paths for correct icon extraction.
        for tool in detect_editors_via_registry() {
            if !results.iter().any(|r: &DetectedTool| r.id == tool.id) {
                results.push(tool);
            }
        }

        // Secondary: CLI detection for tools in PATH but absent from registry
        // (e.g., installed via scoop / winget without standard registry entries)
        let cli_fallback: &[(&str, &str, &str)] = &[
            ("code.cmd", "vscode", "Visual Studio Code"),
            ("cursor.cmd", "cursor", "Cursor"),
            ("antigravity.cmd", "antigravity", "Antigravity"),
            ("idea.cmd", "idea", "IntelliJ IDEA"),
            ("codex.cmd", "codex", "Codex"),
            ("zed.cmd", "zed", "Zed"),
            ("subl.exe", "sublime", "Sublime Text"),
        ];
        for (cmd, id, name) in cli_fallback {
            if !results.iter().any(|r| r.id == *id) {
                if let Some(path) = check_executable(cmd) {
                    results.push(DetectedTool {
                        id: id.to_string(),
                        name: name.to_string(),
                        path,
                        icon: None,
                    });
                }
            }
        }

        // Codex UWP (Windows Store app — not in the standard uninstall registry)
        if !results.iter().any(|r| r.id == "codex") {
            let mut command = Command::new("powershell");
            command
                .args(["-NoProfile", "-Command", "Get-AppxPackage -Name 'OpenAI.Codex' | Select-Object -ExpandProperty InstallLocation"])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null());
            hide_command_window(&mut command);
            if let Some(output) = output_with_timeout(&mut command, TOOL_DETECTION_TIMEOUT_SECS) {
                if output.status.success() {
                    let location = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !location.is_empty() {
                        results.push(DetectedTool {
                            id: "codex".into(),
                            name: "Codex (UWP)".into(),
                            path: location,
                            icon: None,
                        });
                    }
                }
            }
        }

        // Batch icon extraction: single PowerShell process for all .exe paths
        let exe_paths: Vec<String> = results
            .iter()
            .filter(|t| t.icon.is_none() && t.path.to_ascii_lowercase().ends_with(".exe"))
            .map(|t| t.path.clone())
            .collect();
        if !exe_paths.is_empty() {
            let icon_map = extract_windows_exe_icons_batch(&exe_paths);
            for tool in results.iter_mut() {
                if tool.icon.is_none() {
                    if let Some(b64) = icon_map.get(&tool.path) {
                        if !b64.is_empty() {
                            tool.icon = Some(format!("data:image/png;base64,{}", b64));
                        }
                    }
                }
            }
        }
    }

    results
}

fn detect_shells() -> Vec<DetectedTool> {
    let mut results = Vec::new();

    #[cfg(not(target_os = "windows"))]
    {
        let shells = [
            ("zsh", "Zsh"),
            ("bash", "Bash"),
            ("fish", "Fish"),
            ("nu", "Nushell"),
        ];
        for (cmd, name) in &shells {
            if let Some(path) = check_executable(cmd) {
                results.push(DetectedTool {
                    id: cmd.to_string(),
                    name: name.to_string(),
                    path,
                    icon: None,
                });
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // PowerShell 7+ (pwsh)
        if let Some(path) = check_executable("pwsh") {
            results.push(DetectedTool {
                id: "pwsh".into(),
                name: "PowerShell 7".into(),
                path,
                icon: None,
            });
        }
        // Windows PowerShell 5.x
        let ps5 = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        if std::path::Path::new(ps5).exists() {
            results.push(DetectedTool {
                id: "powershell".into(),
                name: "Windows PowerShell".into(),
                path: ps5.to_string(),
                icon: None,
            });
        }
        // CMD
        results.push(DetectedTool {
            id: "cmd".into(),
            name: "CMD".into(),
            path: "cmd.exe".into(),
            icon: None,
        });
        // Git Bash — keep in sync with git_bash_shell_path() in this file.
        let mut git_bash_found = false;
        let git_bash_system_candidates = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ];
        for p in &git_bash_system_candidates {
            if std::path::Path::new(p).exists() {
                results.push(DetectedTool {
                    id: "bash".into(),
                    name: "Git Bash".into(),
                    path: p.to_string(),
                    icon: None,
                });
                git_bash_found = true;
                break;
            }
        }
        if !git_bash_found {
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                let p = format!(r"{}\Programs\Git\bin\bash.exe", local);
                if std::path::Path::new(&p).exists() {
                    results.push(DetectedTool {
                        id: "bash".into(),
                        name: "Git Bash".into(),
                        path: p,
                        icon: None,
                    });
                }
            }
        }
        // Nushell
        if let Some(path) = check_executable("nu") {
            results.push(DetectedTool {
                id: "nu".into(),
                name: "Nushell".into(),
                path,
                icon: None,
            });
        }
    }

    results
}

fn detect_tools_blocking() -> DetectedTools {
    log::info!("[system] Detecting available tools...");
    let tools = DetectedTools {
        git: detect_git(),
        terminals: detect_terminals(),
        editors: detect_editors(),
        shells: detect_shells(),
    };
    let icons_count = tools.editors.iter().filter(|e| e.icon.is_some()).count();
    log::info!(
        "[system] Detected: {} git, {} terminals, {} editors ({} with icons)",
        tools.git.len(),
        tools.terminals.len(),
        tools.editors.len(),
        icons_count
    );
    tools
}

#[tauri::command]
pub(crate) async fn detect_tools() -> DetectedTools {
    detect_tools_internal().await
}

pub async fn detect_tools_internal() -> DetectedTools {
    tokio::task::spawn_blocking(detect_tools_blocking)
        .await
        .unwrap_or_else(|e| {
            log::warn!("[system] Tool detection task failed: {}", e);
            DetectedTools::default()
        })
}

#[tauri::command]
pub(crate) fn set_git_path(path: String) {
    crate::utils::set_custom_git_path(&path);
}

pub fn set_git_path_internal(path: &str) {
    crate::utils::set_custom_git_path(path);
}

pub fn terminate_process_impl(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("Invalid process id".to_string());
    }
    if pid == std::process::id() {
        return Err("Refusing to terminate the current app process".to_string());
    }

    // /T terminates the full process tree. This is intentional: child processes
    // (e.g. language servers, file watchers) spawned by the target process may
    // be the actual holders of file handles, so killing only the parent would
    // leave those handles open and the archive would still be blocked.
    #[cfg(target_os = "windows")]
    let output = {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        hide_command_window(&mut command);
        command
            .output()
            .map_err(|e| format!("Failed to start taskkill: {}", e))?
    };

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output()
        .map_err(|e| format!("Failed to start kill: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "Failed to terminate process {}: {}",
            pid,
            stderr.trim()
        ))
    }
}

#[tauri::command]
pub(crate) fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ==================== 更新镜像检测 ====================

/// 通过 gh-proxy.org 镜像检测最新版本（仅检测，不下载）
/// 返回 JSON: { "version": "...", "pub_date": "...", "notes": "..." }
#[tauri::command]
pub(crate) async fn check_mirror_update(mirror_url: String) -> Result<serde_json::Value, String> {
    log::info!("[system] Checking mirror for updates via {}...", mirror_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let github_url =
        "https://github.com/guoyongchang/worktree-manager/releases/latest/download/latest.json";
    let endpoint = format!("{}{}", mirror_url, github_url);
    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch mirror manifest: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Mirror returned HTTP {}", resp.status()));
    }

    let manifest: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse mirror manifest: {}", e))?;

    let version = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let pub_date = manifest
        .get("pub_date")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let notes = manifest
        .get("notes")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    log::info!(
        "[system] Mirror latest version: {} (pub_date: {})",
        version,
        pub_date
    );

    Ok(serde_json::json!({
        "version": version,
        "pub_date": pub_date,
        "notes": notes,
        "current_version": env!("CARGO_PKG_VERSION"),
    }))
}

// ==================== 更新镜像下载 ====================

/// 通过镜像下载更新的内部实现（单个镜像源）
async fn download_with_mirror(app: &tauri::AppHandle, mirror_url: &str) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    // 1. Fetch latest.json from GitHub (via mirror)
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let github_manifest =
        "https://github.com/guoyongchang/worktree-manager/releases/latest/download/latest.json";
    let endpoint = format!("{}{}", mirror_url, github_manifest);
    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch update manifest: {}", e))?;
    let mut manifest: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse update manifest: {}", e))?;

    // 2. Modify all platform download URLs to use the mirror
    if let Some(platforms) = manifest.get_mut("platforms") {
        if let Some(obj) = platforms.as_object_mut() {
            for (platform, info) in obj.iter_mut() {
                if let Some(url_val) = info.get_mut("url") {
                    if let Some(url_str) = url_val.as_str() {
                        let proxied = format!("{}{}", mirror_url, url_str);
                        log::info!("[system] Proxied URL for {}: {}", platform, proxied);
                        *url_val = serde_json::Value::String(proxied);
                    }
                }
            }
        }
    }

    let manifest_body = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;

    // 3. Start a temporary local HTTP server to serve the modified manifest
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local server: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let router = axum::Router::new().route(
        "/latest.json",
        axum::routing::get(move || {
            let body = manifest_body.clone();
            async move { body }
        }),
    );

    struct AbortServerOnDrop(Option<tokio::task::JoinHandle<()>>);

    impl Drop for AbortServerOnDrop {
        fn drop(&mut self) {
            if let Some(handle) = self.0.take() {
                handle.abort();
            }
        }
    }

    let server_handle = tokio::spawn(async move {
        axum::serve(listener, router).await.ok();
    });
    let mut server_guard = AbortServerOnDrop(Some(server_handle));

    // 4. Create a new updater instance pointing to the local endpoint
    let local_endpoint: url::Url = format!("http://127.0.0.1:{}/latest.json", port)
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;

    log::info!("[system] Local manifest server at: {}", local_endpoint);

    let updater = app
        .updater_builder()
        .endpoints(vec![local_endpoint])
        .map_err(|e| format!("Failed to set endpoints: {}", e))?
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    // 5. Check for update (reads from local server → gets proxied download URLs)
    let update: Option<tauri_plugin_updater::Update> = updater
        .check()
        .await
        .map_err(|e| format!("Mirror update check failed: {}", e))?;

    let update = update.ok_or_else(|| "No update available".to_string())?;
    log::info!("[system] Mirror update found: v{}", update.version);

    // 6. Download and install with progress events emitted to the frontend
    let app_for_chunk = app.clone();
    let app_for_finish = app.clone();
    let mut first_chunk = true;

    update
        .download_and_install(
            move |chunk_len: usize, content_length: Option<u64>| {
                if first_chunk {
                    first_chunk = false;
                    let _ = app_for_chunk.emit(
                        "mirror-update-progress",
                        serde_json::json!({
                            "event": "Started",
                            "data": { "contentLength": content_length.unwrap_or(0) }
                        }),
                    );
                }
                let _ = app_for_chunk.emit(
                    "mirror-update-progress",
                    serde_json::json!({
                        "event": "Progress",
                        "data": { "chunkLength": chunk_len }
                    }),
                );
            },
            move || {
                let _ = app_for_finish.emit(
                    "mirror-update-progress",
                    serde_json::json!({
                        "event": "Finished",
                        "data": {}
                    }),
                );
            },
        )
        .await
        .map_err(|e| format!("Mirror download failed: {}", e))?;

    // 7. Clean up local server
    if let Some(handle) = server_guard.0.take() {
        handle.abort();
    }
    log::info!(
        "[system] Mirror update download complete via {}",
        mirror_url
    );

    Ok(())
}

/// 通过镜像下载更新，支持自动 fallback 到其他可用镜像源
#[tauri::command]
pub(crate) async fn download_update_via_mirror(
    app: tauri::AppHandle,
    mirror_url: String,
) -> Result<(), String> {
    use tauri::Emitter;

    log::info!(
        "[system] Starting mirror update download via {}...",
        mirror_url
    );

    // Build fallback list: primary mirror + cached available mirrors (up to 3 total)
    let mut fallback_list = vec![mirror_url.clone()];
    let cached = crate::mirror::get_cached_results();
    for r in &cached {
        if r.available && r.url != mirror_url && fallback_list.len() < 3 {
            fallback_list.push(r.url.clone());
        }
    }

    log::info!(
        "[system] Fallback mirror list ({} entries): {:?}",
        fallback_list.len(),
        fallback_list
    );

    let mut last_error = String::new();

    for (attempt, url) in fallback_list.iter().enumerate() {
        if attempt > 0 {
            log::info!(
                "[system] Fallback attempt #{}: trying {}...",
                attempt + 1,
                url
            );
            let _ = app.emit(
                "mirror-update-progress",
                serde_json::json!({
                    "event": "Fallback",
                    "data": { "mirror": url, "attempt": attempt + 1 }
                }),
            );
        }

        match download_with_mirror(&app, url).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                log::warn!(
                    "[system] Mirror download failed via {} (attempt {}): {}",
                    url,
                    attempt + 1,
                    e
                );
                last_error = e;
            }
        }
    }

    Err(format!(
        "All {} mirror(s) failed. Last error: {}",
        fallback_list.len(),
        last_error
    ))
}

// ==================== 镜像源管理 ====================

/// 并发 PING 所有镜像源，返回可用性结果（不做吞吐量测速）
#[tauri::command]
pub(crate) async fn test_mirror_speed() -> Result<Vec<crate::mirror::MirrorTestResult>, String> {
    log::info!("[system] Starting mirror PING test...");
    let results = crate::mirror::ping_all_mirrors().await;
    log::info!(
        "[system] Mirror PING test complete, {} results",
        results.len()
    );
    Ok(results)
}

/// 对单个镜像源进行吞吐量测速（10秒）
#[tauri::command]
pub(crate) async fn speed_test_single_mirror(
    mirror_url: String,
) -> Result<crate::mirror::MirrorTestResult, String> {
    log::info!("[system] Speed testing single mirror: {}", mirror_url);
    crate::mirror::speed_test_single(&mirror_url)
        .await
        .ok_or_else(|| format!("Mirror not found: {}", mirror_url))
}

/// 返回所有镜像源（内置 + 自定义）
#[tauri::command]
pub(crate) fn get_mirror_sources() -> Vec<crate::mirror::MirrorSource> {
    crate::mirror::get_all_mirrors()
}

/// 保存用户自定义镜像源到 global.json
#[tauri::command]
pub(crate) fn save_custom_mirrors(mirrors: Vec<crate::types::CustomMirror>) -> Result<(), String> {
    let mut config = crate::config::load_global_config();
    config.custom_mirrors = mirrors;
    crate::config::save_global_config_internal(&config)?;
    crate::mirror::clear_mirror_cache();
    Ok(())
}

// ==================== HTTP Server 共享接口 ====================

pub fn open_in_terminal_internal(
    path: &str,
    terminal: Option<&str>,
    shell: Option<&str>,
) -> Result<(), String> {
    open_in_terminal(
        path.to_string(),
        terminal.map(|s| s.to_string()),
        shell.map(|s| s.to_string()),
    )
}

pub fn open_in_editor_internal(
    request: &OpenEditorRequest,
    custom_path: Option<&str>,
) -> Result<(), String> {
    open_editor_at_path(request, custom_path)
}

pub fn reveal_in_finder_internal(path: &str) -> Result<(), String> {
    reveal_in_finder(path.to_string())
}

pub fn open_log_dir_internal() -> Result<(), String> {
    open_log_dir()
}

pub fn get_app_icon_internal(path: &str) -> Option<String> {
    get_app_icon(path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{pending_crash_report, CrashReport};
    use axum::{http::StatusCode, response::IntoResponse, routing::get, Json, Router};
    use once_cell::sync::Lazy;
    use serde_json::json;
    use serial_test::serial;
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::{Mutex, MutexGuard};
    use std::time::{Duration, Instant};
    use tokio::net::TcpListener;

    static SYSTEM_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock_system_test() -> MutexGuard<'static, ()> {
        SYSTEM_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }

        fn remove(key: &'static str) -> Self {
            let previous = std::env::var_os(key);
            std::env::remove_var(key);
            Self { key, previous }
        }

        fn prepend_path(dir: &Path) -> Self {
            let previous = std::env::var_os("PATH");
            let mut paths = vec![dir.to_path_buf()];
            if let Some(old_path) = previous.as_ref() {
                paths.extend(std::env::split_paths(old_path));
            }
            let joined = std::env::join_paths(paths).expect("join PATH entries");
            std::env::set_var("PATH", joined);
            Self {
                key: "PATH",
                previous,
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    struct GlobalConfigCacheGuard {
        previous: Option<crate::GlobalConfig>,
    }

    impl GlobalConfigCacheGuard {
        fn clear() -> Self {
            let previous = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *cache)
            };
            Self { previous }
        }
    }

    impl Drop for GlobalConfigCacheGuard {
        fn drop(&mut self) {
            let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous.take();
        }
    }

    fn shell_quote(path: &Path) -> String {
        format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
    }

    #[cfg(unix)]
    fn make_fake_command(dir: &Path, name: &str, script_body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{}\n", script_body)).expect("write fake command");
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).expect("chmod fake command");
        path
    }

    #[cfg(windows)]
    fn make_fake_command(dir: &Path, name: &str, script_body: &str) -> PathBuf {
        let path = dir.join(format!("{}.cmd", name));
        std::fs::write(&path, script_body).expect("write fake command");
        path
    }

    fn make_recording_command(dir: &Path, name: &str, record: &Path) -> PathBuf {
        #[cfg(windows)]
        {
            let body = format!(
                "@echo off\r\n(for %%A in (%*) do @echo %%~A) > \"{}\"\r\n",
                record.display()
            );
            make_fake_command(dir, name, &body)
        }
        #[cfg(not(windows))]
        {
            make_fake_command(
                dir,
                name,
                &format!("printf '%s\\n' \"$@\" > {}", shell_quote(record)),
            )
        }
    }

    fn read_recorded_args(record: &Path) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if let Ok(content) = std::fs::read_to_string(record) {
                if !content.is_empty() {
                    return content.lines().map(str::to_string).collect();
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("recorded command args were not written to {:?}", record);
    }

    async fn spawn_manifest_server(
        status: StatusCode,
        body: serde_json::Value,
    ) -> Result<(String, tokio::task::JoinHandle<()>), String> {
        let app = Router::new().route(
            "/{*path}",
            get(move || {
                let body = body.clone();
                async move {
                    if status.is_success() {
                        Json(body).into_response()
                    } else {
                        (status, body.to_string()).into_response()
                    }
                }
            }),
        );
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(err) => return Err(format!("local bind unavailable: {}", err)),
        };
        let addr = listener.local_addr().expect("manifest server addr");
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok((format!("http://{}/", addr), handle))
    }

    async fn spawn_text_server(
        status: StatusCode,
        body: &'static str,
    ) -> Result<(String, tokio::task::JoinHandle<()>), String> {
        let app = Router::new().route(
            "/{*path}",
            get(move || async move { (status, body).into_response() }),
        );
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(err) => return Err(format!("local bind unavailable: {}", err)),
        };
        let addr = listener.local_addr().expect("text server addr");
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok((format!("http://{}/", addr), handle))
    }

    fn command_for_script(script: &str) -> Command {
        #[cfg(target_os = "windows")]
        {
            let mut command = Command::new("cmd");
            command.args(["/C", script]);
            command
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut command = Command::new("sh");
            command.args(["-c", script]);
            command
        }
    }

    #[serial]
    #[test]
    fn windows_terminal_uses_requested_shell_instead_of_default_profile() {
        let launch =
            build_windows_terminal_launch(r"C:\repo", Some("windowsterminal"), Some("cmd"));

        assert_eq!(
            launch,
            WindowsTerminalLaunch {
                program: "wt".to_string(),
                args: vec![
                    "-d".to_string(),
                    r"C:\repo".to_string(),
                    "cmd.exe".to_string(),
                ],
                current_dir: None,
            }
        );
    }

    #[serial]
    #[test]
    fn custom_terminal_path_is_launched_directly() {
        let launch = build_windows_terminal_launch(
            r"C:\repo",
            Some(r"C:\Tools\WezTerm\wezterm-gui.exe"),
            None,
        );

        assert_eq!(
            launch,
            WindowsTerminalLaunch {
                program: r"C:\Tools\WezTerm\wezterm-gui.exe".to_string(),
                args: Vec::new(),
                current_dir: Some(PathBuf::from(r"C:\repo")),
            }
        );
    }

    #[serial]
    #[test]
    fn command_for_log_includes_program_and_arguments() {
        let mut command = Command::new("test-program");
        command.args(["--flag", "value with space"]);

        assert_eq!(
            command_for_log(&command),
            "test-program --flag value with space"
        );
    }

    #[serial]
    #[test]
    fn output_with_timeout_captures_fast_success_stdout_and_stderr() {
        #[cfg(target_os = "windows")]
        let mut command = command_for_script("echo stdout-text && echo stderr-text 1>&2");
        #[cfg(not(target_os = "windows"))]
        let mut command = command_for_script("printf stdout-text; printf stderr-text >&2");
        command.stdout(Stdio::piped()).stderr(Stdio::piped());

        let output = output_with_timeout(&mut command, 1).expect("command should exit");

        assert!(output.status.success());
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("stdout-text"),
            "stdout was {:?}",
            String::from_utf8_lossy(&output.stdout)
        );
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("stderr-text"),
            "stderr was {:?}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[serial]
    #[test]
    fn output_with_timeout_returns_non_success_status_for_fast_failure() {
        #[cfg(target_os = "windows")]
        let mut command = command_for_script("exit /B 7");
        #[cfg(not(target_os = "windows"))]
        let mut command = command_for_script("exit 7");
        command.stdout(Stdio::piped()).stderr(Stdio::piped());

        let output = output_with_timeout(&mut command, 1).expect("command should exit");

        assert!(!output.status.success());
        assert_eq!(output.status.code(), Some(7));
    }

    #[serial]
    #[test]
    fn output_with_timeout_returns_none_for_missing_program() {
        let mut command = Command::new("__worktree_manager_missing_program__");
        command.stdout(Stdio::piped()).stderr(Stdio::piped());

        assert!(output_with_timeout(&mut command, 1).is_none());
    }

    #[serial]
    #[test]
    fn output_with_timeout_kills_process_when_deadline_expires() {
        #[cfg(target_os = "windows")]
        let mut command = command_for_script("ping -n 3 127.0.0.1 > nul");
        #[cfg(not(target_os = "windows"))]
        let mut command = command_for_script("sleep 2");
        command.stdout(Stdio::piped()).stderr(Stdio::piped());

        let started = Instant::now();
        let output = output_with_timeout(&mut command, 0);

        assert!(output.is_none());
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "timeout branch should return promptly"
        );
    }

    #[serial]
    #[test]
    fn windows_shell_command_maps_shell_ids_and_custom_paths() {
        assert!(windows_shell_command(None).is_empty());
        assert!(windows_shell_command(Some("auto")).is_empty());
        assert_eq!(windows_shell_command(Some("cmd")), vec!["cmd.exe"]);
        assert_eq!(windows_shell_command(Some("pwsh")), vec!["pwsh.exe"]);
        assert_eq!(
            windows_shell_command(Some(r"C:\Tools\nu.exe")),
            vec![r"C:\Tools\nu.exe"]
        );

        let bash = windows_shell_command(Some("bash"));
        assert_eq!(bash.len(), 3);
        assert_eq!(bash[1], "--login");
        assert_eq!(bash[2], "-i");
    }

    #[serial]
    #[test]
    fn path_like_executable_detects_absolute_and_separator_paths() {
        assert!(path_like_executable(r"C:\Tools\app.exe"));
        assert!(path_like_executable("/usr/local/bin/app"));
        assert!(path_like_executable("relative/app"));
        assert!(!path_like_executable("cmd"));
    }

    #[serial]
    #[test]
    fn editor_cli_command_maps_known_editors_and_defaults_to_vscode() {
        assert_eq!(editor_cli_command("vscode"), "code");
        assert_eq!(editor_cli_command("cursor"), "cursor");
        assert_eq!(editor_cli_command("antigravity"), "antigravity");
        assert_eq!(editor_cli_command("idea"), "idea");
        assert_eq!(editor_cli_command("codex"), "codex");
        assert_eq!(editor_cli_command("unknown"), "code");
    }

    #[serial]
    #[test]
    fn gitbash_terminal_launch_builds_cd_argument_without_spawning() {
        let launch = build_windows_terminal_launch(r"C:\repo", Some("gitbash"), None);

        assert!(launch.program.ends_with("git-bash.exe"), "{launch:?}");
        assert_eq!(launch.args, vec![r"--cd=C:\repo".to_string()]);
        assert_eq!(launch.current_dir, None);
    }

    #[serial]
    #[test]
    fn windows_terminal_cmd_launch_plan_uses_start_and_cd() {
        let launch = build_windows_terminal_launch(r"C:\repo with spaces", Some("cmd"), None);

        assert_eq!(launch.program, "cmd");
        assert_eq!(
            launch.args,
            vec![
                "/c".to_string(),
                "start".to_string(),
                "cmd".to_string(),
                "/k".to_string(),
                r"cd /d C:\repo with spaces".to_string()
            ]
        );
        assert_eq!(launch.current_dir, None);
    }

    #[serial]
    #[test]
    fn windows_terminal_powershell_launch_plan_sets_location() {
        let launch =
            build_windows_terminal_launch(r"C:\repo with spaces", Some("powershell"), None);

        assert_eq!(launch.program, "cmd");
        assert_eq!(
            launch.args,
            vec![
                "/c".to_string(),
                "start".to_string(),
                "powershell".to_string(),
                "-NoExit".to_string(),
                "-Command".to_string(),
                r"Set-Location 'C:\repo with spaces'".to_string()
            ]
        );
        assert_eq!(launch.current_dir, None);
    }

    #[serial]
    #[test]
    fn windows_terminal_auto_launch_plan_appends_requested_shell() {
        let launch = build_windows_terminal_launch(r"C:\repo", Some("auto"), Some("pwsh"));

        assert_eq!(launch.program, "wt");
        assert_eq!(
            launch.args,
            vec![
                "-d".to_string(),
                r"C:\repo".to_string(),
                "pwsh.exe".to_string()
            ]
        );
        assert_eq!(launch.current_dir, None);
    }

    #[serial]
    #[test]
    fn windows_terminal_custom_launch_plan_sets_current_dir() {
        let launch = build_windows_terminal_launch(r"C:\repo", Some("custom-term"), None);

        assert_eq!(launch.program, "custom-term");
        assert!(launch.args.is_empty());
        assert_eq!(launch.current_dir, Some(PathBuf::from(r"C:\repo")));
    }

    #[serial]
    #[test]
    fn get_app_version_returns_package_version() {
        assert_eq!(get_app_version(), env!("CARGO_PKG_VERSION"));
    }

    #[serial]
    #[test]
    fn detect_tools_blocking_finds_fake_cli_tools_from_path() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("fake tool dir");
        for name in [
            "code",
            "cursor",
            "antigravity",
            "idea",
            "codex",
            "zed",
            "sublime_text",
            "zsh",
            "bash",
            "fish",
            "nu",
            "gnome-terminal",
            "konsole",
            "xterm",
            "alacritty",
            "kitty",
            "ghostty",
            "wezterm",
            "tilix",
        ] {
            make_fake_command(temp.path(), name, "exit 0");
        }
        let _path = EnvVarGuard::prepend_path(temp.path());

        let tools = detect_tools_blocking();

        assert!(tools.git.iter().any(|tool| tool.id == "git"));
        for id in [
            "vscode",
            "cursor",
            "antigravity",
            "idea",
            "codex",
            "zed",
            "sublime",
        ] {
            assert!(
                tools.editors.iter().any(|tool| tool.id == id),
                "missing editor {id}: {:?}",
                tools.editors
            );
        }
        for id in ["zsh", "bash", "fish", "nu"] {
            assert!(
                tools.shells.iter().any(|tool| tool.id == id),
                "missing shell {id}: {:?}",
                tools.shells
            );
        }
        #[cfg(target_os = "linux")]
        for id in [
            "gnome-terminal",
            "konsole",
            "xterm",
            "alacritty",
            "kitty",
            "ghostty",
            "wezterm",
            "tilix",
        ] {
            assert!(
                tools.terminals.iter().any(|tool| tool.id == id),
                "missing terminal {id}: {:?}",
                tools.terminals
            );
        }
        #[cfg(target_os = "macos")]
        assert!(tools.terminals.iter().any(|tool| tool.id == "terminal"));
    }

    #[serial]
    #[test]
    fn get_crash_report_takes_pending_report_once() {
        let _serial = lock_system_test();
        let mut pending = pending_crash_report()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = pending.take();
        *pending = Some(CrashReport {
            abnormal_exit: true,
            crash_detail: Some("panic at startup".to_string()),
            previous_session_info: Some("session.running".to_string()),
        });
        drop(pending);

        let first = get_crash_report().expect("pending crash report");
        let second = get_crash_report();

        assert!(first.abnormal_exit);
        assert_eq!(first.crash_detail.as_deref(), Some("panic at startup"));
        assert_eq!(
            first.previous_session_info.as_deref(),
            Some("session.running")
        );
        assert!(second.is_none());

        let mut pending = pending_crash_report()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *pending = previous;
    }

    #[serial]
    #[test]
    fn terminate_process_rejects_invalid_and_current_process_ids() {
        assert_eq!(
            terminate_process_impl(0),
            Err("Invalid process id".to_string())
        );
        assert_eq!(
            terminate_process_impl(std::process::id()),
            Err("Refusing to terminate the current app process".to_string())
        );
    }

    #[serial]
    #[test]
    fn open_editor_at_path_uses_custom_executable_and_path_argument() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let record = temp.path().join("editor-args.txt");
        let editor = make_recording_command(temp.path(), "custom-editor", &record);
        let request = crate::types::OpenEditorRequest {
            editor: "cursor".to_string(),
            path: temp.path().join("workspace").to_string_lossy().to_string(),
        };

        open_editor_at_path(&request, Some(editor.to_str().unwrap())).expect("spawn editor");
        std::thread::sleep(Duration::from_millis(50));

        assert_eq!(read_recorded_args(&record), vec![request.path]);
    }

    #[serial]
    #[test]
    fn open_editor_at_path_reports_missing_custom_executable() {
        let request = crate::types::OpenEditorRequest {
            editor: "cursor".to_string(),
            path: "/tmp/workspace".to_string(),
        };
        let missing = tempfile::tempdir().unwrap().path().join("missing-editor");

        let err = open_editor_at_path(&request, Some(missing.to_str().unwrap())).unwrap_err();

        assert!(err.contains("无法打开编辑器"));
        assert!(err.contains("missing-editor"));
    }

    #[serial]
    #[test]
    fn open_editor_at_path_uses_codex_app_subcommand_for_custom_executable() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let record = temp.path().join("codex-editor-args.txt");
        let editor = make_recording_command(temp.path(), "custom-codex", &record);
        let request = crate::types::OpenEditorRequest {
            editor: "codex".to_string(),
            path: temp.path().join("workspace").to_string_lossy().to_string(),
        };

        open_editor_at_path(&request, Some(editor.to_str().unwrap())).expect("spawn codex");

        assert_eq!(
            read_recorded_args(&record),
            vec!["app".to_string(), request.path]
        );
    }

    #[cfg(target_os = "macos")]
    #[serial]
    #[test]
    fn open_in_terminal_uses_open_with_selected_macos_app() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let record = temp.path().join("open-args.txt");
        make_recording_command(temp.path(), "open", &record);
        let _path = EnvVarGuard::prepend_path(temp.path());
        let workspace = temp.path().join("space dir");
        std::fs::create_dir_all(&workspace).unwrap();

        open_in_terminal(
            workspace.to_string_lossy().to_string(),
            Some("warp".to_string()),
            Some("bash".to_string()),
        )
        .expect("spawn open");
        std::thread::sleep(Duration::from_millis(50));

        assert_eq!(
            read_recorded_args(&record),
            vec![
                "-a".to_string(),
                "Warp".to_string(),
                workspace.to_string_lossy().to_string()
            ]
        );
    }

    #[cfg(target_os = "linux")]
    #[serial]
    #[test]
    fn open_in_terminal_uses_first_available_linux_terminal_with_cwd() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let record = temp.path().join("terminal-cwd.txt");
        make_fake_command(
            temp.path(),
            "x-terminal-emulator",
            &format!("pwd > {}", shell_quote(&record)),
        );
        let _path = EnvVarGuard::prepend_path(temp.path());
        let workspace = temp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();

        open_in_terminal(workspace.to_string_lossy().to_string(), None, None)
            .expect("spawn terminal");
        std::thread::sleep(Duration::from_millis(50));

        assert_eq!(
            std::fs::read_to_string(&record).unwrap().trim(),
            workspace.to_string_lossy()
        );
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[serial]
    #[test]
    fn reveal_in_finder_spawns_platform_file_manager_with_path() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let record = temp.path().join("reveal-args.txt");
        #[cfg(target_os = "macos")]
        make_recording_command(temp.path(), "open", &record);
        #[cfg(target_os = "linux")]
        make_recording_command(temp.path(), "xdg-open", &record);
        let _path = EnvVarGuard::prepend_path(temp.path());
        let target = temp.path().join("target folder");
        std::fs::create_dir_all(&target).unwrap();

        reveal_in_finder(target.to_string_lossy().to_string()).expect("spawn file manager");
        std::thread::sleep(Duration::from_millis(50));

        assert_eq!(
            read_recorded_args(&record),
            vec![target.to_string_lossy().to_string()]
        );
    }

    #[cfg(target_os = "macos")]
    #[serial]
    #[test]
    fn log_dir_uses_home_library_logs_and_open_launcher() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let bin = tempfile::tempdir().expect("bin dir");
        let record = temp.path().join("log-open-args.txt");
        make_recording_command(bin.path(), "open", &record);
        let _home = EnvVarGuard::set("HOME", temp.path());
        let _path = EnvVarGuard::prepend_path(bin.path());

        let log_dir = get_platform_log_dir().expect("mac log dir");
        open_log_dir().expect("open log dir");
        std::thread::sleep(Duration::from_millis(50));

        assert_eq!(
            log_dir,
            temp.path().join("Library/Logs/com.guo.worktree-manager")
        );
        assert!(log_dir.exists());
        assert_eq!(
            read_recorded_args(&record),
            vec![log_dir.to_string_lossy().to_string()]
        );
    }

    #[cfg(target_os = "linux")]
    #[serial]
    #[test]
    fn log_dir_uses_xdg_data_home_and_xdg_open_launcher() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let bin = tempfile::tempdir().expect("bin dir");
        let record = temp.path().join("log-open-args.txt");
        make_recording_command(bin.path(), "xdg-open", &record);
        let data_home = temp.path().join("data");
        let _xdg = EnvVarGuard::set("XDG_DATA_HOME", &data_home);
        let _path = EnvVarGuard::prepend_path(bin.path());

        let log_dir = get_platform_log_dir().expect("linux log dir");
        open_log_dir().expect("open log dir");
        std::thread::sleep(Duration::from_millis(50));

        assert_eq!(log_dir, data_home.join("com.guo.worktree-manager/logs"));
        assert!(log_dir.exists());
        assert_eq!(
            read_recorded_args(&record),
            vec![log_dir.to_string_lossy().to_string()]
        );
    }

    #[cfg(target_os = "macos")]
    #[serial]
    #[test]
    fn get_platform_log_dir_reports_missing_home_on_macos() {
        let _serial = lock_system_test();
        let _home = EnvVarGuard::remove("HOME");

        assert_eq!(get_platform_log_dir(), Err("无法获取用户目录".to_string()));
    }

    #[serial]
    #[test]
    fn get_app_icon_returns_none_for_missing_path_without_extracting() {
        let missing = tempfile::tempdir()
            .unwrap()
            .path()
            .join("missing-app")
            .to_string_lossy()
            .to_string();

        assert!(get_app_icon(missing).is_none());
    }

    #[serial]
    #[tokio::test]
    async fn check_mirror_update_parses_manifest_and_adds_current_version() {
        let Ok((base_url, server)) = spawn_manifest_server(
            StatusCode::OK,
            json!({
                "version": "9.8.7",
                "pub_date": "2026-06-11T00:00:00Z",
                "notes": "unit manifest"
            }),
        )
        .await
        else {
            // The managed sandbox can deny loopback binds; avoid external APIs in that case.
            return;
        };

        let manifest = check_mirror_update(base_url)
            .await
            .expect("mirror manifest");
        server.abort();

        assert_eq!(manifest["version"], "9.8.7");
        assert_eq!(manifest["pub_date"], "2026-06-11T00:00:00Z");
        assert_eq!(manifest["notes"], "unit manifest");
        assert_eq!(manifest["current_version"], env!("CARGO_PKG_VERSION"));
    }

    #[serial]
    #[tokio::test]
    async fn check_mirror_update_reports_non_success_http_status() {
        let Ok((base_url, server)) =
            spawn_manifest_server(StatusCode::BAD_GATEWAY, json!({"error": "bad mirror"})).await
        else {
            // The managed sandbox can deny loopback binds; avoid external APIs in that case.
            return;
        };

        let err = check_mirror_update(base_url).await.unwrap_err();
        server.abort();

        assert_eq!(err, "Mirror returned HTTP 502 Bad Gateway");
    }

    #[serial]
    #[tokio::test]
    async fn check_mirror_update_reports_invalid_mirror_url_without_http() {
        let err = check_mirror_update("not a url".to_string())
            .await
            .unwrap_err();

        assert!(err.contains("Failed to fetch mirror manifest"), "{err}");
    }

    #[serial]
    #[test]
    fn save_custom_mirrors_persists_config_and_get_mirror_sources_appends_them() {
        let _serial = lock_system_test();
        let _cache = GlobalConfigCacheGuard::clear();
        let temp = tempfile::tempdir().expect("temp home");
        let _home = EnvVarGuard::set("HOME", temp.path());
        let custom = crate::types::CustomMirror {
            name: "Local Mirror".to_string(),
            url: "https://mirror.example/".to_string(),
        };

        save_custom_mirrors(vec![custom.clone()]).expect("save custom mirror");
        let sources = get_mirror_sources();
        let config_text = std::fs::read_to_string(crate::config::get_global_config_path()).unwrap();
        let config_json: serde_json::Value = serde_json::from_str(&config_text).unwrap();

        let saved = sources
            .iter()
            .find(|source| source.name == custom.name)
            .expect("custom mirror source");
        assert_eq!(saved.url, custom.url);
        assert!(!saved.builtin);
        assert_eq!(config_json["custom_mirrors"][0]["name"], custom.name);
        assert_eq!(config_json["custom_mirrors"][0]["url"], custom.url);
    }

    #[serial]
    #[test]
    fn open_in_editor_wrapper_uses_custom_executable() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let record = temp.path().join("wrapped-editor-args.txt");
        let editor = make_recording_command(temp.path(), "wrapped-editor", &record);
        let request_path = temp.path().join("workspace").to_string_lossy().to_string();
        let request = crate::types::OpenEditorRequest {
            editor: "vscode".to_string(),
            path: request_path.clone(),
        };

        open_in_editor(request, Some(editor.to_string_lossy().to_string()))
            .expect("open editor through command wrapper");

        assert_eq!(read_recorded_args(&record), vec![request_path]);
    }

    #[cfg(target_os = "macos")]
    #[serial]
    #[test]
    fn macos_editor_app_launch_records_known_app_names() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let record = temp.path().join("open-editor-args.txt");
        make_recording_command(temp.path(), "open", &record);
        let _path = EnvVarGuard::prepend_path(temp.path());
        let workspace = temp.path().join("space dir");
        std::fs::create_dir_all(&workspace).unwrap();
        let request = crate::types::OpenEditorRequest {
            editor: "idea".to_string(),
            path: workspace.to_string_lossy().to_string(),
        };

        open_editor_at_path(&request, None).expect("open editor app through macOS open");

        assert_eq!(
            read_recorded_args(&record),
            vec![
                "-a".to_string(),
                "IntelliJ IDEA".to_string(),
                workspace.to_string_lossy().to_string()
            ]
        );
        assert_eq!(editor_app_name("vscode"), "Visual Studio Code");
        assert_eq!(editor_app_name("cursor"), "Cursor");
        assert_eq!(editor_app_name("antigravity"), "Antigravity");
        assert_eq!(editor_app_name("codex"), "Codex");
        assert_eq!(editor_app_name("unknown"), "Visual Studio Code");
    }

    #[cfg(target_os = "macos")]
    #[serial]
    #[test]
    fn macos_custom_app_and_icon_failure_paths_return_without_display() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let record = temp.path().join("custom-app-open-args.txt");
        make_recording_command(temp.path(), "open", &record);
        let _path = EnvVarGuard::prepend_path(temp.path());
        let workspace = temp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let app_bundle = temp.path().join("Custom Editor.app");
        std::fs::create_dir_all(&app_bundle).expect("create custom app bundle");
        let request = crate::types::OpenEditorRequest {
            editor: "cursor".to_string(),
            path: workspace.to_string_lossy().to_string(),
        };

        open_editor_at_path(&request, Some(app_bundle.to_str().unwrap()))
            .expect("custom .app should be launched through open -a");
        assert_eq!(
            read_recorded_args(&record),
            vec![
                "-a".to_string(),
                app_bundle.to_string_lossy().to_string(),
                workspace.to_string_lossy().to_string()
            ]
        );

        let app_contents = app_bundle.join("Contents");
        let resources = app_contents.join("Resources");
        std::fs::create_dir_all(&resources).expect("create app resources");
        std::fs::write(
            app_contents.join("Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIconFile</key><string>MissingIcon</string></dict></plist>
"#,
        )
        .expect("write plist with missing icon");
        assert!(get_app_icon(app_bundle.to_string_lossy().to_string()).is_none());

        std::fs::write(resources.join("MissingIcon.icns"), b"not an icns").expect("write bad icon");
        assert!(get_app_icon(app_bundle.to_string_lossy().to_string()).is_none());
    }

    #[cfg(target_os = "macos")]
    #[serial]
    #[test]
    fn internal_launcher_wrappers_forward_to_platform_commands() {
        let _serial = lock_system_test();
        let temp = tempfile::tempdir().expect("temp dir");
        let open_record = temp.path().join("internal-open-args.txt");
        make_recording_command(temp.path(), "open", &open_record);
        let _path = EnvVarGuard::prepend_path(temp.path());
        let target = temp.path().join("target folder");
        std::fs::create_dir_all(&target).unwrap();

        open_in_terminal_internal(&target.to_string_lossy(), Some("ghostty"), None)
            .expect("open terminal through internal wrapper");
        assert_eq!(
            read_recorded_args(&open_record),
            vec![
                "-a".to_string(),
                "Ghostty".to_string(),
                target.to_string_lossy().to_string()
            ]
        );

        let reveal_record = temp.path().join("internal-reveal-args.txt");
        make_recording_command(temp.path(), "open", &reveal_record);
        reveal_in_finder_internal(&target.to_string_lossy())
            .expect("reveal through internal wrapper");
        assert_eq!(
            read_recorded_args(&reveal_record),
            vec![target.to_string_lossy().to_string()]
        );

        assert!(
            get_app_icon_internal(&temp.path().join("missing.app").to_string_lossy()).is_none()
        );
    }

    #[serial]
    #[test]
    fn terminate_process_reports_os_error_for_nonexistent_process() {
        let impossible_pid = u32::MAX;
        assert_ne!(impossible_pid, std::process::id());

        let err = terminate_process_impl(impossible_pid).unwrap_err();

        assert!(
            err.contains("Failed to terminate process"),
            "unexpected termination error: {err}"
        );
        assert!(err.contains(&impossible_pid.to_string()), "{err}");
    }

    #[serial]
    #[tokio::test]
    async fn mirror_update_handles_missing_fields_invalid_json_and_unknown_speed_url() {
        let Ok((base_url, missing_fields_server)) =
            spawn_manifest_server(StatusCode::OK, json!({})).await
        else {
            return;
        };
        let manifest = check_mirror_update(base_url)
            .await
            .expect("missing fields default to empty strings");
        missing_fields_server.abort();
        assert_eq!(manifest["version"], "");
        assert_eq!(manifest["pub_date"], "");
        assert_eq!(manifest["notes"], "");
        assert_eq!(manifest["current_version"], env!("CARGO_PKG_VERSION"));

        let Ok((bad_url, bad_json_server)) =
            spawn_text_server(StatusCode::OK, "not valid json").await
        else {
            return;
        };
        let err = check_mirror_update(bad_url).await.unwrap_err();
        bad_json_server.abort();
        assert!(err.contains("Failed to parse mirror manifest"), "{err}");

        let speed_err = speed_test_single_mirror("https://not-a-configured-mirror.invalid/".into())
            .await
            .unwrap_err();
        assert!(
            speed_err.contains("Mirror not found: https://not-a-configured-mirror.invalid/"),
            "{speed_err}"
        );
    }

    #[serial]
    #[tokio::test]
    async fn detect_tools_internal_and_git_path_commands_are_reachable() {
        set_git_path("".to_string());
        set_git_path_internal("");

        let tools = detect_tools_internal().await;

        assert!(
            tools.git.iter().any(|tool| tool.id == "git"),
            "expected git in detected tools: {:?}",
            tools.git
        );
    }
}

// ==================== 前端日志转发 ====================

#[tauri::command]
pub(crate) async fn frontend_log(level: String, message: String) {
    // Truncate to 4096 chars and strip control characters to prevent log injection
    let sanitized: String = message
        .chars()
        .take(4096)
        .filter(|c| !c.is_control() || *c == '\n')
        .collect();
    match level.as_str() {
        "error" => log::error!("[frontend] {}", sanitized),
        "warn" => log::warn!("[frontend] {}", sanitized),
        "info" => log::info!("[frontend] {}", sanitized),
        "debug" => log::debug!("[frontend] {}", sanitized),
        _ => log::info!("[frontend] {}", sanitized),
    }
}
