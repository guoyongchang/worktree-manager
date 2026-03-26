use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

use crate::types::OpenEditorRequest;
use crate::utils::normalize_path;

// ==================== Tauri 命令：工具 ====================

#[tauri::command]
pub(crate) fn open_in_terminal(path: String, terminal: Option<String>) -> Result<(), String> {
    let normalized = normalize_path(&path);
    let term = terminal.as_deref().unwrap_or("auto");
    log::info!(
        "[system] Opening terminal at: {} (type: {})",
        normalized,
        term
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
                return Err(format!("Failed to open terminal {}: {}", app_name, e));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let result = match term {
            "cmd" => Command::new("cmd")
                .args(["/c", "start", "cmd", "/k", &format!("cd /d {}", normalized)])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn(),
            "powershell" => Command::new("cmd")
                .args([
                    "/c",
                    "start",
                    "powershell",
                    "-NoExit",
                    "-Command",
                    &format!("Set-Location '{}'", normalized),
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn(),
            "windowsterminal" => Command::new("wt").args(["-d", &normalized]).spawn(),
            "gitbash" => {
                // Search common Git Bash locations
                let candidates = [
                    r"C:\Program Files\Git\git-bash.exe",
                    r"C:\Program Files (x86)\Git\git-bash.exe",
                ];
                let mut git_bash_path: Option<String> = None;
                for p in &candidates {
                    if std::path::Path::new(p).exists() {
                        git_bash_path = Some(p.to_string());
                        break;
                    }
                }
                if git_bash_path.is_none() {
                    if let Ok(local) = std::env::var("LOCALAPPDATA") {
                        let p = format!(r"{}\Programs\Git\git-bash.exe", local);
                        if std::path::Path::new(&p).exists() {
                            git_bash_path = Some(p);
                        }
                    }
                }
                match git_bash_path {
                    Some(p) => Command::new(p).arg(&format!("--cd={}", normalized)).spawn(),
                    None => Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "Git Bash not found",
                    )),
                }
            }
            _ => {
                // "auto": try WT first, then cmd
                let wt_result = Command::new("wt").args(["-d", &normalized]).spawn();
                if wt_result.is_ok() {
                    wt_result
                } else {
                    Command::new("cmd")
                        .args(["/c", "start", "cmd", "/k", &format!("cd /d {}", normalized)])
                        .creation_flags(CREATE_NO_WINDOW)
                        .spawn()
                }
            }
        };

        match result {
            Ok(_) => log::info!("[system] Spawned terminal '{}' for: {}", term, normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn terminal '{}': {}", term, e);
                return Err(format!("Failed to open terminal: {}", e));
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
                        return Err(format!("无法打开编辑器 {}: {}", exe, e));
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
                    return Err(format!("无法打开编辑器 {}: {}", exe, e));
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
                    return Err(format!("无法打开 Codex，请确认已安装该编辑器: {}", e));
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
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

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
                    return Err(format!("无法打开 Codex: {}", e));
                }
            }
        } else {
            match Command::new(cmd).arg(path).spawn() {
                Ok(_) => {
                    log::info!("[system] Spawned {} for: {}", cmd, path);
                }
                Err(e) => {
                    log::error!("[system] Failed to spawn editor process: {}", e);
                    return Err(format!("无法打开编辑器 {}: {}", cmd, e));
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
                return Err(format!("无法打开编辑器 {}: {}", cmd, e));
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
                return Err(format!("无法打开文件夹: {}", e));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        match Command::new("explorer").arg(&normalized).spawn() {
            Ok(_) => log::info!("[system] Spawned Explorer for: {}", normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn Explorer: {}", e);
                return Err(format!("无法打开文件夹: {}", e));
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        match Command::new("xdg-open").arg(&normalized).spawn() {
            Ok(_) => log::info!("[system] Spawned xdg-open for: {}", normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn xdg-open: {}", e);
                return Err(format!("无法打开文件夹: {}", e));
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
        std::fs::create_dir_all(&log_dir).map_err(|e| format!("无法创建日志目录: {}", e))?;
    }

    let dir_str = log_dir.to_str().unwrap_or("");

    #[cfg(target_os = "macos")]
    {
        match Command::new("open").arg(dir_str).spawn() {
            Ok(_) => log::info!("[system] Spawned Finder for log directory"),
            Err(e) => {
                log::error!("[system] Failed to open log directory: {}", e);
                return Err(format!("无法打开日志目录: {}", e));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        match Command::new("explorer").arg(dir_str).spawn() {
            Ok(_) => log::info!("[system] Spawned Explorer for log directory"),
            Err(e) => {
                log::error!("[system] Failed to open log directory: {}", e);
                return Err(format!("无法打开日志目录: {}", e));
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        match Command::new("xdg-open").arg(dir_str).spawn() {
            Ok(_) => log::info!("[system] Spawned xdg-open for log directory"),
            Err(e) => {
                log::error!("[system] Failed to open log directory: {}", e);
                return Err(format!("无法打开日志目录: {}", e));
            }
        }
    }

    Ok(())
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
        .arg(app.join("Contents/Info.plist").to_string_lossy().to_string())
        .arg("CFBundleIconFile")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !plist_output.status.success() {
        return None;
    }

    let mut icon_file = String::from_utf8_lossy(&plist_output.stdout).trim().to_string();
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
    let tmp_png = format!("/tmp/wm_icon_{}.png", app.file_name()?.to_string_lossy().replace(' ', "_"));
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

/// Extract icon from a Windows .exe file using PowerShell + System.Drawing
#[cfg(target_os = "windows")]
fn extract_windows_exe_icon(exe_path: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if exe_path.is_empty() || !std::path::Path::new(exe_path).exists() {
        return None;
    }

    let ps_script = format!(
        r#"
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('{}')
if ($icon) {{
    $bmp = $icon.ToBitmap()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    [Convert]::ToBase64String($ms.ToArray())
}}
"#,
        exe_path.replace("'", "''")
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let b64 = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if b64.is_empty() {
        return None;
    }

    Some(format!("data:image/png;base64,{}", b64))
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

#[derive(Debug, Clone, Serialize)]
pub struct DetectedTools {
    pub git: Vec<DetectedTool>,
    pub terminals: Vec<DetectedTool>,
    pub editors: Vec<DetectedTool>,
    pub shells: Vec<DetectedTool>,
}

fn check_executable(name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = Command::new("where")
            .arg(name)
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            return s.lines().next().map(|l| l.trim().to_string());
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("/usr/bin/which")
            .arg(name)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
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
        // Git Bash
        let git_bash_candidates = [
            r"C:\Program Files\Git\git-bash.exe",
            r"C:\Program Files (x86)\Git\git-bash.exe",
        ];
        for p in &git_bash_candidates {
            if std::path::Path::new(p).exists() {
                results.push(DetectedTool {
                    id: "gitbash".into(),
                    name: "Git Bash".into(),
                    path: p.to_string(),
                    icon: None,
                });
                break;
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

    results
}

fn detect_editors() -> Vec<DetectedTool> {
    let mut results = Vec::new();

    let editors = [
        ("code", "vscode", "Visual Studio Code"),
        ("cursor", "cursor", "Cursor"),
        ("antigravity", "antigravity", "Antigravity"),
        ("idea", "idea", "IntelliJ IDEA"),
        ("codex", "codex", "Codex"),
        ("zed", "zed", "Zed"),
        ("sublime_text", "sublime", "Sublime Text"),
    ];

    for (cmd, id, name) in &editors {
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
            ("/Applications/Visual Studio Code - Insiders.app", "vscode-insiders", "VS Code Insiders"),
            ("/Applications/VSCodium.app", "vscodium", "VSCodium"),
            // AI-powered editors
            ("/Applications/Cursor.app", "cursor", "Cursor"),
            ("/Applications/Antigravity.app", "antigravity", "Antigravity"),
            ("/Applications/Windsurf.app", "windsurf", "Windsurf"),
            ("/Applications/Trae.app", "trae", "Trae"),
            // JetBrains family
            ("/Applications/IntelliJ IDEA.app", "idea", "IntelliJ IDEA"),
            ("/Applications/IntelliJ IDEA CE.app", "idea-ce", "IntelliJ IDEA CE"),
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
            ("/Applications/Android Studio.app", "android-studio", "Android Studio"),
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
        let app_lookup: std::collections::HashMap<&str, &str> = mac_apps.iter()
            .map(|(path, id, _)| (*id, *path))
            .collect();
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
        // Comprehensive Windows IDE scanning
        let win_apps: &[(&str, &str, &str)] = &[
            // VS Code family
            (r"Microsoft VS Code\Code.exe", "vscode", "VS Code"),
            (r"Microsoft VS Code Insiders\Code - Insiders.exe", "vscode-insiders", "VS Code Insiders"),
            (r"VSCodium\VSCodium.exe", "vscodium", "VSCodium"),
            // AI-powered editors
            (r"Cursor\Cursor.exe", "cursor", "Cursor"),
            (r"Antigravity\Antigravity.exe", "antigravity", "Antigravity"),
            (r"Windsurf\Windsurf.exe", "windsurf", "Windsurf"),
            (r"Trae\Trae.exe", "trae", "Trae"),
            // JetBrains family
            (r"JetBrains\IntelliJ IDEA*\bin\idea64.exe", "idea", "IntelliJ IDEA"),
            (r"JetBrains\WebStorm*\bin\webstorm64.exe", "webstorm", "WebStorm"),
            (r"JetBrains\PyCharm*\bin\pycharm64.exe", "pycharm", "PyCharm"),
            (r"JetBrains\GoLand*\bin\goland64.exe", "goland", "GoLand"),
            (r"JetBrains\Rider*\bin\rider64.exe", "rider", "Rider"),
            (r"JetBrains\CLion*\bin\clion64.exe", "clion", "CLion"),
            (r"JetBrains\RustRover*\bin\rustrover64.exe", "rustrover", "RustRover"),
            (r"JetBrains\Fleet*\bin\Fleet.exe", "fleet", "Fleet"),
            (r"JetBrains\DataGrip*\bin\datagrip64.exe", "datagrip", "DataGrip"),
            (r"JetBrains\PhpStorm*\bin\phpstorm64.exe", "phpstorm", "PhpStorm"),
            // Google
            (r"Android\Android Studio\bin\studio64.exe", "android-studio", "Android Studio"),
            // Other editors
            (r"Sublime Text\sublime_text.exe", "sublime", "Sublime Text"),
            (r"Zed\zed.exe", "zed", "Zed"),
        ];

        let env_bases: Vec<String> = [
            std::env::var("LOCALAPPDATA").ok(),
            std::env::var("PROGRAMFILES").ok(),
            std::env::var("PROGRAMFILES(X86)").ok(),
            std::env::var("APPDATA").ok(),
        ]
        .iter()
        .filter_map(|v| v.clone())
        .collect();

        for (rel, id, name) in win_apps {
            if results.iter().any(|r| r.id == *id) {
                continue;
            }
            // Handle wildcard patterns (JetBrains versioned dirs like "IntelliJ IDEA 2024.1")
            if rel.contains('*') {
                // Split pattern at the wildcard: "JetBrains\IntelliJ IDEA*\bin\idea64.exe"
                // -> dir_prefix = "JetBrains", pattern_prefix = "IntelliJ IDEA", suffix = "bin\idea64.exe"
                let parts: Vec<&str> = rel.splitn(2, '*').collect();
                if parts.len() == 2 {
                    let before_star = parts[0].trim_end_matches('\\');
                    let after_star = parts[1].trim_start_matches('\\');
                    // Split before_star into parent dir and name prefix
                    let (parent_rel, name_prefix) = if let Some(pos) = before_star.rfind('\\') {
                        (&before_star[..pos], &before_star[pos + 1..])
                    } else {
                        ("", before_star)
                    };

                    'base_loop: for base in &env_bases {
                        let parent_dir = if parent_rel.is_empty() {
                            base.clone()
                        } else {
                            format!("{}\\{}", base, parent_rel)
                        };
                        if let Ok(entries) = std::fs::read_dir(&parent_dir) {
                            for entry in entries.flatten() {
                                let entry_name = entry.file_name().to_string_lossy().to_string();
                                if entry_name.starts_with(name_prefix) && entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                                    let full = format!("{}\\{}\\{}", parent_dir, entry_name, after_star);
                                    if std::path::Path::new(&full).exists() {
                                        let icon = extract_windows_exe_icon(&full);
                                        results.push(DetectedTool {
                                            id: id.to_string(),
                                            name: name.to_string(),
                                            path: full,
                                            icon,
                                        });
                                        break 'base_loop;
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                for base in &env_bases {
                    let full = format!(r"{}\{}", base, rel);
                    if std::path::Path::new(&full).exists() {
                        let icon = extract_windows_exe_icon(&full);
                        results.push(DetectedTool {
                            id: id.to_string(),
                            name: name.to_string(),
                            path: full,
                            icon,
                        });
                        break;
                    }
                }
            }
        }

        // Detect Codex UWP app
        if !results.iter().any(|r| r.id == "codex") {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let ps_result = Command::new("powershell")
                .args(["-NoProfile", "-Command", "Get-AppxPackage -Name 'OpenAI.Codex' | Select-Object -ExpandProperty InstallLocation"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .output();
            if let Ok(output) = ps_result {
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

        // Backfill icons for CLI-detected editors
        let win_lookup: std::collections::HashMap<&str, &str> = win_apps.iter()
            .map(|(_, id, _)| (*id, *id))
            .collect();
        for tool in results.iter_mut() {
            if tool.icon.is_none() && win_lookup.contains_key(tool.id.as_str()) {
                tool.icon = extract_windows_exe_icon(&tool.path);
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
            ("pwsh", "PowerShell"),
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
        // Git Bash
        let git_bash_candidates = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ];
        for p in &git_bash_candidates {
            if std::path::Path::new(p).exists() {
                results.push(DetectedTool {
                    id: "bash".into(),
                    name: "Git Bash".into(),
                    path: p.to_string(),
                    icon: None,
                });
                break;
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

#[tauri::command]
pub(crate) fn detect_tools() -> DetectedTools {
    log::info!("[system] Detecting available tools...");
    let tools = DetectedTools {
        git: detect_git(),
        terminals: detect_terminals(),
        editors: detect_editors(),
        shells: detect_shells(),
    };
    log::info!(
        "[system] Detected: {} git, {} terminals, {} editors",
        tools.git.len(),
        tools.terminals.len(),
        tools.editors.len()
    );
    tools
}

pub fn detect_tools_internal() -> DetectedTools {
    detect_tools()
}

#[tauri::command]
pub(crate) fn set_git_path(path: String) {
    crate::utils::set_custom_git_path(&path);
}

pub fn set_git_path_internal(path: &str) {
    crate::utils::set_custom_git_path(path);
}

#[tauri::command]
pub(crate) fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ==================== 更新镜像检测 ====================

/// 通过 gh-proxy.org 镜像检测最新版本（仅检测，不下载）
/// 返回 JSON: { "version": "...", "pub_date": "...", "notes": "..." }
#[tauri::command]
pub(crate) async fn check_mirror_update() -> Result<serde_json::Value, String> {
    log::info!("[system] Checking mirror for updates...");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let endpoint =
        "https://gh-proxy.org/https://github.com/guoyongchang/worktree-manager/releases/latest/download/latest.json";
    let resp = client
        .get(endpoint)
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

/// 通过 gh-proxy.org 镜像下载更新（内置更新流程，非浏览器跳转）
/// 原理：获取 latest.json → 将下载 URL 替换为 gh-proxy 代理 → 用本地临时服务提供修改后的 manifest → 走 Tauri 内置更新器
#[tauri::command]
pub(crate) async fn download_update_via_mirror(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    log::info!("[system] Starting mirror update download...");

    // 1. Fetch latest.json from GitHub
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let endpoint =
        "https://github.com/guoyongchang/worktree-manager/releases/latest/download/latest.json";
    let resp = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch update manifest: {}", e))?;
    let mut manifest: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse update manifest: {}", e))?;

    // 2. Modify all platform download URLs to use gh-proxy.org
    if let Some(platforms) = manifest.get_mut("platforms") {
        if let Some(obj) = platforms.as_object_mut() {
            for (platform, info) in obj.iter_mut() {
                if let Some(url_val) = info.get_mut("url") {
                    if let Some(url_str) = url_val.as_str() {
                        let proxied = format!("https://gh-proxy.org/{}", url_str);
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
    //    on_chunk callback: FnMut(chunk_length: usize, content_length: Option<u64>)
    //    on_download_finish callback: FnOnce()
    let app_for_chunk = app.clone();
    let app_for_finish = app.clone();
    let mut first_chunk = true;

    update
        .download_and_install(
            move |chunk_len: usize, content_length: Option<u64>| {
                // Emit "Started" on the first chunk
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
                // Emit "Progress" for every chunk
                let _ = app_for_chunk.emit(
                    "mirror-update-progress",
                    serde_json::json!({
                        "event": "Progress",
                        "data": { "chunkLength": chunk_len }
                    }),
                );
            },
            move || {
                // Emit "Finished" when download completes
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
    log::info!("[system] Mirror update download complete");

    Ok(())
}

// ==================== HTTP Server 共享接口 ====================

pub fn open_in_terminal_internal(path: &str, terminal: Option<&str>) -> Result<(), String> {
    open_in_terminal(path.to_string(), terminal.map(|s| s.to_string()))
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
