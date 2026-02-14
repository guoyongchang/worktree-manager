use std::path::PathBuf;
use std::process::Command;

use crate::types::OpenEditorRequest;
use crate::utils::normalize_path;

// ==================== Tauri 命令：工具 ====================

#[tauri::command]
pub(crate) fn open_in_terminal(path: String) -> Result<(), String> {
    let normalized = normalize_path(&path);

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", &normalized])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        // Try Windows Terminal first, then fallback to cmd
        let wt_result = Command::new("wt")
            .args(["-d", &normalized])
            .spawn();

        if wt_result.is_err() {
            Command::new("cmd")
                .args(["/c", "start", "cmd", "/k", &format!("cd /d {}", normalized)])
                .spawn()
                .map_err(|e| format!("Failed to open terminal: {}", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
        let mut opened = false;
        for term in &terminals {
            let result = if *term == "gnome-terminal" {
                Command::new(term)
                    .args(["--working-directory", &normalized])
                    .spawn()
            } else {
                Command::new(term)
                    .current_dir(&normalized)
                    .spawn()
            };
            if result.is_ok() {
                opened = true;
                break;
            }
        }
        if !opened {
            return Err("No terminal emulator found".to_string());
        }
    }

    Ok(())
}

fn editor_cli_command(editor: &str) -> &'static str {
    match editor {
        "vscode" => "code",
        "cursor" => "cursor",
        "idea" => "idea",
        _ => "code",
    }
}

#[cfg(target_os = "macos")]
fn editor_app_name(editor: &str) -> &'static str {
    match editor {
        "vscode" => "Visual Studio Code",
        "cursor" => "Cursor",
        "idea" => "IntelliJ IDEA",
        _ => "Visual Studio Code",
    }
}

pub(crate) fn open_editor_at_path(request: &OpenEditorRequest) -> Result<(), String> {
    let path = &request.path;

    #[cfg(target_os = "macos")]
    {
        let app_name = editor_app_name(&request.editor);
        if Command::new("open").args(["-a", app_name, path]).spawn().is_ok() {
            return Ok(());
        }
        let cmd = editor_cli_command(&request.editor);
        Command::new(cmd).arg(path).spawn()
            .map_err(|_| format!("无法打开 {}，请确认已安装该编辑器", app_name))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let cmd = editor_cli_command(&request.editor);
        Command::new(cmd).arg(path).spawn()
            .map_err(|e| format!("无法打开编辑器 {}: {}", cmd, e))?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn open_in_editor(request: OpenEditorRequest) -> Result<(), String> {
    open_editor_at_path(&request)
}

#[tauri::command]
pub(crate) fn reveal_in_finder(path: String) -> Result<(), String> {
    let normalized = normalize_path(&path);

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn open_log_dir() -> Result<(), String> {
    let home = std::env::var("HOME")
        .map_err(|_| "无法获取用户目录".to_string())?;
    let log_dir = PathBuf::from(&home).join("Library/Logs/com.guo.worktree-manager");

    if !log_dir.exists() {
        return Err("日志目录不存在".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(log_dir.to_str().unwrap_or(""))
            .spawn()
            .map_err(|e| format!("无法打开日志目录: {}", e))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new("xdg-open")
            .arg(log_dir.to_str().unwrap_or(""))
            .spawn()
            .map_err(|e| format!("无法打开日志目录: {}", e))?;
    }

    Ok(())
}

// ==================== HTTP Server 共享接口 ====================

pub fn open_in_terminal_internal(path: &str) -> Result<(), String> {
    open_in_terminal(path.to_string())
}

pub fn open_in_editor_internal(request: &OpenEditorRequest) -> Result<(), String> {
    open_editor_at_path(request)
}

pub fn reveal_in_finder_internal(path: &str) -> Result<(), String> {
    reveal_in_finder(path.to_string())
}

pub fn open_log_dir_internal() -> Result<(), String> {
    open_log_dir()
}
