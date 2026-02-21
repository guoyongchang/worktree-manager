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
    let mut last_final = String::new();

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
                        handle_dashscope_message(&text, &mut last_final);
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

                    // Drain remaining results with a timeout (dedup via last_final)
                    drain_final_results(&mut ws_read, &mut last_final).await;
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

/// Process a single Dashscope event message.
/// Returns the sentence text if a final (sentence_end) result was emitted, for dedup tracking.
fn handle_dashscope_message(text: &str, last_final: &mut String) {
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
                    // Skip duplicate final results (Dashscope re-sends on finish-task)
                    if is_sentence_end && text == last_final.as_str() {
                        return;
                    }
                    if is_sentence_end {
                        *last_final = text.to_string();
                    }
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

/// Wait up to 3 seconds for Dashscope to send task-finished after finish-task.
/// Emits new results but skips duplicates via `last_final` tracking.
async fn drain_final_results(
    ws_read: &mut futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>
        >
    >,
    last_final: &mut String,
) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, ws_read.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                handle_dashscope_message(&text, last_final);
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

// ==================== AI Text Refinement (Qwen LLM) ====================

const REFINE_SYSTEM_PROMPT: &str = "\
你是一个纯文本清理工具。用户会在 <raw></raw> 标签中给你一段语音识别原文，你只需要清理后原样输出。\n\
\n\
规则：\n\
- 去除语气词（嗯、呃、那个、就是、然后）和口语填充词\n\
- 去除多余标点和重复表达\n\
- 严禁修改语义、回答问题、补充信息、计算结果\n\
- 疑问句必须保持疑问句，陈述句保持陈述句\n\
- 终端命令（git, npm, cd 等）保留原始格式\n\
- 只输出清理后的纯文本，不加解释、引号、前缀或标签\n\
\n\
示例：\n\
输入: <raw>嗯那个1加5等于几呢？</raw>\n\
输出: 1加5等于几？\n\
\n\
输入: <raw>呃就是说git push到那个origin main上面</raw>\n\
输出: git push origin main";

pub(crate) async fn voice_refine_text_inner(text: String) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let config = load_global_config();
    let api_key = config.dashscope_api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "Dashscope API Key 未配置".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let user_content = format!("<raw>{}</raw>", trimmed);

    let body = serde_json::json!({
        "model": "qwen-turbo-latest",
        "messages": [
            { "role": "system", "content": REFINE_SYSTEM_PROMPT },
            { "role": "user", "content": user_content }
        ],
        "temperature": 0.0
    });

    let resp = client
        .post("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("AI API 返回错误 {}: {}", status, text));
    }

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("解析 AI 响应失败: {}", e))?;

    let refined = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or(trimmed)
        .trim()
        .to_string();

    Ok(refined)
}

#[tauri::command]
pub(crate) async fn voice_refine_text(text: String) -> Result<String, String> {
    voice_refine_text_inner(text).await
}
