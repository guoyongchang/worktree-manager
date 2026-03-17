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
        match Command::new("open")
            .args(["-a", "Terminal", &normalized])
            .spawn()
        {
            Ok(_) => log::info!("[system] Spawned Terminal.app for: {}", normalized),
            Err(e) => {
                log::error!("[system] Failed to spawn Terminal.app: {}", e);
                return Err(format!("Failed to open terminal: {}", e));
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
            match Command::new(exe).arg(path).spawn() {
                Ok(_) => {
                    log::info!("[system] Spawned custom editor '{}' for: {}", exe, path);
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

    #[cfg(not(target_os = "macos"))]
    {
        let cmd = editor_cli_command(&request.editor);
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

// ==================== Tool Detection ====================

#[derive(Debug, Clone, Serialize)]
pub struct DetectedTool {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetectedTools {
    pub git: Vec<DetectedTool>,
    pub terminals: Vec<DetectedTool>,
    pub editors: Vec<DetectedTool>,
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
        let output = Command::new("which")
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
        });
        if std::path::Path::new("/Applications/iTerm.app").exists() {
            results.push(DetectedTool {
                id: "iterm2".into(),
                name: "iTerm2".into(),
                path: "/Applications/iTerm.app".into(),
            });
        }
        if std::path::Path::new("/Applications/Warp.app").exists() {
            results.push(DetectedTool {
                id: "warp".into(),
                name: "Warp".into(),
                path: "/Applications/Warp.app".into(),
            });
        }
        if std::path::Path::new("/Applications/Alacritty.app").exists() {
            results.push(DetectedTool {
                id: "alacritty".into(),
                name: "Alacritty".into(),
                path: "/Applications/Alacritty.app".into(),
            });
        }
        if std::path::Path::new("/Applications/kitty.app").exists() {
            results.push(DetectedTool {
                id: "kitty".into(),
                name: "kitty".into(),
                path: "/Applications/kitty.app".into(),
            });
        }
    }

    #[cfg(target_os = "windows")]
    {
        results.push(DetectedTool {
            id: "cmd".into(),
            name: "CMD".into(),
            path: "cmd.exe".into(),
        });
        results.push(DetectedTool {
            id: "powershell".into(),
            name: "PowerShell".into(),
            path: "powershell.exe".into(),
        });
        if check_executable("wt").is_some() {
            results.push(DetectedTool {
                id: "windowsterminal".into(),
                name: "Windows Terminal".into(),
                path: "wt.exe".into(),
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
            ("wezterm", "WezTerm"),
            ("tilix", "Tilix"),
        ];
        for (cmd, name) in &terminals {
            if let Some(path) = check_executable(cmd) {
                results.push(DetectedTool {
                    id: cmd.to_string(),
                    name: name.to_string(),
                    path,
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
        ("zed", "zed", "Zed"),
        ("sublime_text", "sublime", "Sublime Text"),
        ("atom", "atom", "Atom"),
        ("nvim", "neovim", "Neovim"),
        ("vim", "vim", "Vim"),
    ];

    for (cmd, id, name) in &editors {
        if let Some(path) = check_executable(cmd) {
            results.push(DetectedTool {
                id: id.to_string(),
                name: name.to_string(),
                path,
            });
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mac_apps = [
            (
                "/Applications/Visual Studio Code.app",
                "vscode",
                "Visual Studio Code",
            ),
            ("/Applications/Cursor.app", "cursor", "Cursor"),
            (
                "/Applications/Antigravity.app",
                "antigravity",
                "Antigravity",
            ),
            ("/Applications/Zed.app", "zed", "Zed"),
            ("/Applications/Sublime Text.app", "sublime", "Sublime Text"),
        ];
        for (app_path, id, name) in &mac_apps {
            if std::path::Path::new(app_path).exists() && !results.iter().any(|r| r.id == *id) {
                results.push(DetectedTool {
                    id: id.to_string(),
                    name: name.to_string(),
                    path: app_path.to_string(),
                });
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let win_locations = [
            (
                r"Microsoft VS Code\Code.exe",
                "vscode",
                "Visual Studio Code",
            ),
            (r"Cursor\Cursor.exe", "cursor", "Cursor"),
            (
                r"Programs\Microsoft VS Code\Code.exe",
                "vscode",
                "Visual Studio Code",
            ),
        ];
        for base in &[
            std::env::var("LOCALAPPDATA").ok(),
            std::env::var("PROGRAMFILES").ok(),
            std::env::var("PROGRAMFILES(X86)").ok(),
        ] {
            if let Some(base) = base {
                for (rel, id, name) in &win_locations {
                    let full = format!(r"{}\{}", base, rel);
                    if std::path::Path::new(&full).exists() && !results.iter().any(|r| r.id == *id)
                    {
                        results.push(DetectedTool {
                            id: id.to_string(),
                            name: name.to_string(),
                            path: full,
                        });
                    }
                }
            }
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
