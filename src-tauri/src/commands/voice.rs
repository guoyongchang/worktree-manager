use once_cell::sync::Lazy;
use std::sync::Mutex;
use tokio::sync::{mpsc, watch};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;

use tauri::Emitter;

use crate::config::{load_global_config, save_global_config_internal};
use crate::state::APP_HANDLE;

// ==================== Voice Session State ====================

struct VoiceSession {
    audio_tx: mpsc::Sender<Vec<u8>>,
    stop_tx: watch::Sender<bool>,
}

static VOICE_SESSION: Lazy<Mutex<Option<VoiceSession>>> = Lazy::new(|| Mutex::new(None));

fn emit_event(event: &str, payload: serde_json::Value) {
    if let Some(handle) = APP_HANDLE.lock().ok().and_then(|h| h.clone()) {
        let _ = handle.emit(event, payload.clone());
    }
    // Also broadcast to WebSocket clients
    if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
        "event": event,
        "payload": payload,
    })) {
        let _ = crate::state::VOICE_BROADCAST.send(json_str);
    }
}

/// 从 Dashscope 返回的 JSON 中提取事件名称
/// 客户端发送的指令用 header.action，服务端返回的事件用 header.event
fn get_event_name(json: &serde_json::Value) -> &str {
    json["header"]["event"].as_str().unwrap_or("")
}

// ==================== Dashscope API Key Commands ====================

pub(crate) fn get_dashscope_api_key_inner() -> Result<Option<String>, String> {
    let config = load_global_config();
    Ok(config.dashscope_api_key)
}

pub(crate) fn set_dashscope_api_key_inner(key: String) -> Result<(), String> {
    let mut config = load_global_config();
    config.dashscope_api_key = if key.is_empty() { None } else { Some(key) };
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_dashscope_api_key() -> Result<Option<String>, String> {
    get_dashscope_api_key_inner()
}

#[tauri::command]
pub(crate) async fn set_dashscope_api_key(key: String) -> Result<(), String> {
    set_dashscope_api_key_inner(key)
}

// ==================== Dashscope Base URL Commands ====================

const DEFAULT_DASHSCOPE_WS_URL: &str = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";

pub(crate) fn get_dashscope_base_url_inner() -> Result<Option<String>, String> {
    let config = load_global_config();
    Ok(config.dashscope_base_url)
}

pub(crate) fn set_dashscope_base_url_inner(url: String) -> Result<(), String> {
    let mut config = load_global_config();
    config.dashscope_base_url = if url.is_empty() { None } else { Some(url) };
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_dashscope_base_url() -> Result<Option<String>, String> {
    get_dashscope_base_url_inner()
}

#[tauri::command]
pub(crate) async fn set_dashscope_base_url(url: String) -> Result<(), String> {
    set_dashscope_base_url_inner(url)
}

// ==================== Voice Session Commands ====================

pub(crate) async fn voice_start_inner(sample_rate: Option<u32>) -> Result<(), String> {
    // Check if already active
    {
        let session = VOICE_SESSION.lock().map_err(|e| e.to_string())?;
        if session.is_some() {
            return Err("语音会话已在进行中".to_string());
        }
    }

    let config = load_global_config();
    let api_key = config.dashscope_api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "请先在设置中配置 Dashscope API Key".to_string())?;

    let actual_sample_rate = sample_rate.unwrap_or(16000);

    // Build WebSocket request with auth header
    let ws_url = config.dashscope_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| DEFAULT_DASHSCOPE_WS_URL.to_string());
    // Extract host from URL for the Host header
    let ws_host = ws_url.replace("wss://", "").replace("ws://", "")
        .split('/').next().unwrap_or("dashscope.aliyuncs.com").to_string();

    let request = tokio_tungstenite::tungstenite::http::Request::builder()
        .uri(&ws_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Host", &ws_host)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", tokio_tungstenite::tungstenite::handshake::client::generate_key())
        .body(())
        .map_err(|e| format!("构建 WebSocket 请求失败: {}", e))?;

    let (ws_stream, _) = tokio_tungstenite::connect_async(request).await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

    let (mut ws_write, mut ws_read) = ws_stream.split();

    // Generate a unique task ID
    let task_id = uuid::Uuid::new_v4().to_string();

    // Send run-task message (客户端指令用 header.action)
    let run_task = serde_json::json!({
        "header": {
            "action": "run-task",
            "task_id": task_id,
            "streaming": "duplex"
        },
        "payload": {
            "task_group": "audio",
            "task": "asr",
            "function": "recognition",
            "model": "paraformer-realtime-v2",
            "parameters": {
                "format": "pcm",
                "sample_rate": actual_sample_rate,
                "disfluency_removal_enabled": true
            },
            "input": {}
        }
    });

    ws_write.send(Message::Text(run_task.to_string().into()))
        .await
        .map_err(|e| format!("发送 run-task 失败: {}", e))?;

    // Wait for task-started event (服务端事件用 header.event)
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        async {
            while let Some(msg) = ws_read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                            let event = get_event_name(&json);
                            if event == "task-started" {
                                return Ok(());
                            }
                            if event == "task-failed" {
                                let err_msg = json["header"]["error_message"]
                                    .as_str()
                                    .unwrap_or("unknown error");
                                return Err(format!("Dashscope 任务启动失败: {}", err_msg));
                            }
                        }
                    }
                    Err(e) => return Err(format!("WebSocket 读取错误: {}", e)),
                    _ => {}
                }
            }
            Err("WebSocket 连接意外关闭".to_string())
        }
    ).await.map_err(|_| "等待 Dashscope 响应超时".to_string())??;

    // Create channels
    let (audio_tx, audio_rx) = mpsc::channel::<Vec<u8>>(64);
    let (stop_tx, stop_rx) = watch::channel(false);

    // Store session
    {
        let mut session = VOICE_SESSION.lock().map_err(|e| e.to_string())?;
        *session = Some(VoiceSession { audio_tx, stop_tx });
    }

    // Spawn background task that owns ws_write, ws_read, and the channel receivers
    tokio::spawn(voice_session_task(ws_write, ws_read, audio_rx, stop_rx, task_id));

    Ok(())
}

#[tauri::command]
pub(crate) async fn voice_start(sample_rate: Option<u32>) -> Result<(), String> {
    voice_start_inner(sample_rate).await
}

/// Background task handling bidirectional WebSocket communication with Dashscope
async fn voice_session_task(
    mut ws_write: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>
        >,
        Message
    >,
    mut ws_read: futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>
        >
    >,
    mut audio_rx: mpsc::Receiver<Vec<u8>>,
    mut stop_rx: watch::Receiver<bool>,
    task_id: String,
) {
    emit_event("voice-started", serde_json::json!({}));

    loop {
        tokio::select! {
            // Forward audio data from frontend to Dashscope
            audio = audio_rx.recv() => {
                match audio {
                    Some(pcm_data) => {
                        if let Err(e) = ws_write.send(Message::Binary(pcm_data.into())).await {
                            log::error!("[voice] Failed to send audio: {}", e);
                            emit_event("voice-error", serde_json::json!({ "message": format!("发送音频数据失败: {}", e) }));
                            break;
                        }
                    }
                    None => break, // Channel closed
                }
            }
            // Receive recognition results from Dashscope
            msg = ws_read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_dashscope_message(&text);
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                            let event = get_event_name(&json);
                            if event == "task-finished" || event == "task-failed" {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => {
                        log::error!("[voice] WebSocket read error: {}", e);
                        emit_event("voice-error", serde_json::json!({ "message": format!("WebSocket 错误: {}", e) }));
                        break;
                    }
                    _ => {}
                }
            }
            // Stop signal from voice_stop command
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    // Send finish-task to Dashscope (客户端指令用 header.action)
                    let finish = serde_json::json!({
                        "header": {
                            "action": "finish-task",
                            "task_id": task_id,
                            "streaming": "duplex"
                        },
                        "payload": {
                            "input": {}
                        }
                    });
                    let _ = ws_write.send(Message::Text(finish.to_string().into())).await;

                    // Drain remaining results with a timeout
                    drain_final_results(&mut ws_read).await;
                    break;
                }
            }
        }
    }

    // Cleanup
    let _ = ws_write.close().await;
    {
        if let Ok(mut session) = VOICE_SESSION.lock() {
            *session = None;
        }
    }
    emit_event("voice-stopped", serde_json::json!({}));
}

/// Process a single Dashscope event message
fn handle_dashscope_message(text: &str) {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else { return };
    let event = get_event_name(&json);

    match event {
        "result-generated" => {
            // sentence 结构: { text, sentence_end, begin_time, end_time, ... }
            if let Some(sentence) = json["payload"]["output"]["sentence"].as_object() {
                let text = sentence.get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let is_sentence_end = sentence.get("sentence_end")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if !text.is_empty() {
                    emit_event("voice-result", serde_json::json!({
                        "text": text,
                        "is_final": is_sentence_end
                    }));
                }
            }
        }
        "task-failed" => {
            let err_msg = json["header"]["error_message"]
                .as_str()
                .unwrap_or("unknown error");
            emit_event("voice-error", serde_json::json!({ "message": err_msg }));
        }
        _ => {}
    }
}

/// Wait up to 3 seconds for final recognition results after sending finish-task
async fn drain_final_results(
    ws_read: &mut futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>
        >
    >,
) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, ws_read.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                handle_dashscope_message(&text);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let event = get_event_name(&json);
                    if event == "task-finished" || event == "task-failed" {
                        break;
                    }
                }
            }
            _ => break,
        }
    }
}

pub(crate) fn voice_send_audio_inner(data: String) -> Result<(), String> {
    let pcm_bytes = BASE64.decode(&data)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    let session = VOICE_SESSION.lock().map_err(|e| e.to_string())?;
    if let Some(ref s) = *session {
        s.audio_tx.try_send(pcm_bytes)
            .map_err(|e| format!("发送音频数据失败: {}", e))?;
        Ok(())
    } else {
        Err("没有活跃的语音会话".to_string())
    }
}

pub(crate) fn voice_stop_inner() -> Result<(), String> {
    let session = VOICE_SESSION.lock().map_err(|e| e.to_string())?;
    if let Some(ref s) = *session {
        let _ = s.stop_tx.send(true);
        Ok(())
    } else {
        Ok(()) // Already stopped
    }
}

pub(crate) fn voice_is_active_inner() -> Result<bool, String> {
    let session = VOICE_SESSION.lock().map_err(|e| e.to_string())?;
    Ok(session.is_some())
}

#[tauri::command]
pub(crate) async fn voice_send_audio(data: String) -> Result<(), String> {
    voice_send_audio_inner(data)
}

#[tauri::command]
pub(crate) async fn voice_stop() -> Result<(), String> {
    voice_stop_inner()
}

#[tauri::command]
pub(crate) async fn voice_is_active() -> Result<bool, String> {
    voice_is_active_inner()
}
