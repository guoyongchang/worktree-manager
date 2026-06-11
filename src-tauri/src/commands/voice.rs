use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use std::sync::Mutex;
use tokio::sync::{mpsc, watch};
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

#[tauri::command]
pub(crate) fn check_dashscope_api_key() -> bool {
    let config = crate::config::load_global_config();
    config
        .dashscope_api_key
        .as_ref()
        .map(|k| !k.is_empty())
        .unwrap_or(false)
}

// ==================== Commit AI API Key Commands ====================

#[allow(dead_code)]
pub(crate) fn get_commit_ai_api_key_inner() -> Result<Option<String>, String> {
    let config = load_global_config();
    Ok(config.commit_ai_api_key)
}

#[allow(dead_code)]
pub(crate) fn set_commit_ai_api_key_inner(key: String) -> Result<(), String> {
    let mut config = load_global_config();
    config.commit_ai_api_key = if key.is_empty() { None } else { Some(key) };
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) async fn get_commit_ai_api_key() -> Result<Option<String>, String> {
    get_commit_ai_api_key_inner()
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) async fn set_commit_ai_api_key(key: String) -> Result<(), String> {
    set_commit_ai_api_key_inner(key)
}

pub(crate) fn set_commit_ai_enabled_inner(enabled: bool) -> Result<(), String> {
    let mut config = load_global_config();
    config.commit_ai_enabled = enabled;
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) async fn set_commit_ai_enabled(enabled: bool) -> Result<(), String> {
    set_commit_ai_enabled_inner(enabled)
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) async fn get_commit_ai_enabled() -> bool {
    let config = crate::config::load_global_config();
    config.commit_ai_enabled
}

#[tauri::command]
#[allow(dead_code)]
pub(crate) fn check_commit_ai_api_key() -> bool {
    let config = crate::config::load_global_config();
    config
        .commit_ai_api_key
        .as_ref()
        .map(|k| !k.is_empty())
        .unwrap_or(false)
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

// ==================== Voice Refine Toggle ====================

pub(crate) fn get_voice_refine_enabled_inner() -> Result<bool, String> {
    let config = load_global_config();
    Ok(config.voice_refine_enabled)
}

pub(crate) fn set_voice_refine_enabled_inner(enabled: bool) -> Result<(), String> {
    let mut config = load_global_config();
    config.voice_refine_enabled = enabled;
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_voice_refine_enabled() -> Result<bool, String> {
    get_voice_refine_enabled_inner()
}

#[tauri::command]
pub(crate) async fn set_voice_refine_enabled(enabled: bool) -> Result<(), String> {
    set_voice_refine_enabled_inner(enabled)
}

// ==================== Voice Refine Base URL ====================

const DEFAULT_REFINE_BASE_URL: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";

pub(crate) fn get_voice_refine_base_url_inner() -> Result<Option<String>, String> {
    let config = load_global_config();
    Ok(config.voice_refine_base_url)
}

pub(crate) fn set_voice_refine_base_url_inner(url: String) -> Result<(), String> {
    let mut config = load_global_config();
    config.voice_refine_base_url = if url.is_empty() { None } else { Some(url) };
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_voice_refine_base_url() -> Result<Option<String>, String> {
    get_voice_refine_base_url_inner()
}

#[tauri::command]
pub(crate) async fn set_voice_refine_base_url(url: String) -> Result<(), String> {
    set_voice_refine_base_url_inner(url)
}

// ==================== Voice Model Config ====================

pub(crate) fn get_voice_asr_model_inner() -> Result<Option<String>, String> {
    let config = load_global_config();
    Ok(config.voice_asr_model)
}

pub(crate) fn set_voice_asr_model_inner(model: String) -> Result<(), String> {
    let mut config = load_global_config();
    config.voice_asr_model = if model.is_empty() { None } else { Some(model) };
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_voice_asr_model() -> Result<Option<String>, String> {
    get_voice_asr_model_inner()
}

#[tauri::command]
pub(crate) async fn set_voice_asr_model(model: String) -> Result<(), String> {
    set_voice_asr_model_inner(model)
}

pub(crate) fn get_voice_refine_model_inner() -> Result<Option<String>, String> {
    let config = load_global_config();
    Ok(config.voice_refine_model)
}

pub(crate) fn set_voice_refine_model_inner(model: String) -> Result<(), String> {
    let mut config = load_global_config();
    config.voice_refine_model = if model.is_empty() { None } else { Some(model) };
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_voice_refine_model() -> Result<Option<String>, String> {
    get_voice_refine_model_inner()
}

#[tauri::command]
pub(crate) async fn set_voice_refine_model(model: String) -> Result<(), String> {
    set_voice_refine_model_inner(model)
}

// ==================== Dashscope Models List ====================

pub(crate) async fn list_dashscope_models_inner() -> Result<Vec<String>, String> {
    let config = load_global_config();
    let api_key = config.dashscope_api_key.ok_or("未配置 Dashscope API Key")?;
    let base_url = config
        .voice_refine_base_url
        .unwrap_or_else(|| DEFAULT_REFINE_BASE_URL.to_string());
    let url = format!("{}/models", base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {}", e))?;

    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("Models API error: {}", msg));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse models response error: {}", e))?;

    let mut models: Vec<String> = body["data"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();
    models.sort();
    Ok(models)
}

#[tauri::command]
pub(crate) async fn list_dashscope_models() -> Result<Vec<String>, String> {
    list_dashscope_models_inner().await
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
    let api_key = config
        .dashscope_api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "请先在设置中配置 Dashscope API Key".to_string())?;

    let actual_sample_rate = sample_rate.unwrap_or(16000);

    // Build WebSocket request with auth header
    let ws_url = config
        .dashscope_base_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| DEFAULT_DASHSCOPE_WS_URL.to_string());
    // Extract host from URL for the Host header
    let ws_host = ws_url
        .replace("wss://", "")
        .replace("ws://", "")
        .split('/')
        .next()
        .unwrap_or("dashscope.aliyuncs.com")
        .to_string();

    let request = tokio_tungstenite::tungstenite::http::Request::builder()
        .uri(&ws_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Host", &ws_host)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header(
            "Sec-WebSocket-Key",
            tokio_tungstenite::tungstenite::handshake::client::generate_key(),
        )
        .body(())
        .map_err(|e| format!("构建 WebSocket 请求失败: {}", e))?;

    let (ws_stream, _) = tokio_tungstenite::connect_async(request)
        .await
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
            "model": config.voice_asr_model.as_deref().unwrap_or("paraformer-realtime-v2"),
            "parameters": {
                "format": "pcm",
                "sample_rate": actual_sample_rate,
                "disfluency_removal_enabled": true
            },
            "input": {}
        }
    });

    ws_write
        .send(Message::Text(run_task.to_string().into()))
        .await
        .map_err(|e| format!("发送 run-task 失败: {}", e))?;

    // Wait for task-started event (服务端事件用 header.event)
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
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
    })
    .await
    .map_err(|_| "等待 Dashscope 响应超时".to_string())??;

    // Create channels
    let (audio_tx, audio_rx) = mpsc::channel::<Vec<u8>>(64);
    let (stop_tx, stop_rx) = watch::channel(false);

    // Store session
    {
        let mut session = VOICE_SESSION.lock().map_err(|e| e.to_string())?;
        *session = Some(VoiceSession { audio_tx, stop_tx });
    }

    // Spawn background task that owns ws_write, ws_read, and the channel receivers
    tokio::spawn(voice_session_task(
        ws_write, ws_read, audio_rx, stop_rx, task_id,
    ));

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
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    mut ws_read: futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
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
    let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };
    let event = get_event_name(&json);

    match event {
        "result-generated" => {
            // sentence 结构: { text, sentence_end, begin_time, end_time, ... }
            if let Some(sentence) = json["payload"]["output"]["sentence"].as_object() {
                let text = sentence.get("text").and_then(|v| v.as_str()).unwrap_or("");
                let is_sentence_end = sentence
                    .get("sentence_end")
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
                    emit_event(
                        "voice-result",
                        serde_json::json!({
                            "text": text,
                            "is_final": is_sentence_end
                        }),
                    );
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
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
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
    let pcm_bytes = BASE64
        .decode(&data)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    let session = VOICE_SESSION.lock().map_err(|e| e.to_string())?;
    if let Some(ref s) = *session {
        s.audio_tx
            .try_send(pcm_bytes)
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

// ==================== Unified AI Chat Helper ====================

pub(crate) async fn call_ai_chat(
    messages: Vec<serde_json::Value>,
    model: Option<&str>,
    temperature: f64,
    purpose: &str,
) -> Result<String, String> {
    let messages_value = serde_json::Value::Array(messages);

    // Try cloud first
    if crate::cloud_client::is_cloud_configured() {
        match crate::cloud_client::cloud_ai_chat(
            &messages_value,
            model,
            false,
            purpose,
            Some(temperature),
        )
        .await
        {
            Ok(resp_text) => {
                let resp: serde_json::Value = serde_json::from_str(&resp_text)
                    .map_err(|e| format!("parse cloud response error: {}", e))?;
                let content = resp["choices"][0]["message"]["content"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                return Ok(content);
            }
            Err(e) if e.is_auth_failed() => {
                return Err(format!("云端认证已过期，请重新配对: {}", e));
            }
            Err(e) if e.is_network_error() => {
                log::warn!("Cloud AI failed (network), falling back to local: {}", e);
            }
            Err(e) => {
                return Err(format!("云端 AI 请求失败: {}", e));
            }
        }
    }

    // Fallback: local Dashscope
    let config = crate::config::load_global_config();
    // Use commit_ai_api_key for commit_ai purpose, dashscope_api_key for others
    let (api_key, base_url) = if purpose == "commit_ai" {
        let key = config
            .commit_ai_api_key
            .ok_or("未配置 Commit AI API Key，请在设置中配置")?;
        let url = config
            .dashscope_base_url
            .unwrap_or_else(|| DEFAULT_REFINE_BASE_URL.to_string());
        (key, url)
    } else {
        let key = config
            .dashscope_api_key
            .ok_or("未配置 AI 能力（无云端连接且无本地 API Key）")?;
        let url = config
            .voice_refine_base_url
            .unwrap_or_else(|| DEFAULT_REFINE_BASE_URL.to_string());
        (key, url)
    };

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model.unwrap_or("qwen-turbo-latest"),
        "messages": messages_value,
        "temperature": temperature,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {}", e))?;

    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("AI API error: {}", msg));
    }

    let resp_json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parse response error: {}", e))?;
    Ok(resp_json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string())
}

// ==================== AI Text Refinement (Qwen LLM) ====================

const REFINE_SYSTEM_PROMPT: &str = r#"你是一个语音转文字的排版工具（类似 Typeless）。用户在 <raw></raw> 中给你语音识别原文，你负责清理和排版，然后原样输出。

## 清理规则
- 去除语气词（嗯、呃、那个、就是、然后、对、啊）和口语填充词
- 去除重复表达和多余停顿
- 修正明显的语音识别错误（同音字纠错）
- 补充合理的标点符号

## 排版规则
- 当用户说出"第一/第二/第三"或"首先/其次/最后"等序号词时，格式化为编号列表
- 当内容包含明显的多个要点时，用换行分隔
- 终端命令（git, npm, cd 等）保留原始格式，用 backtick 包裹

## 严格禁止
- 严禁回答问题、计算结果、补充信息、给出建议
- 严禁改变语义——疑问句保持疑问句，陈述句保持陈述句
- 严禁添加解释、引号、前缀、XML 标签或任何额外内容
- 你不是 AI 助手，不要尝试理解或执行用户的意图，只做排版

## 示例
输入: <raw>嗯那个1加1等于几呢</raw>
输出: 1加1等于几？

输入: <raw>呃就是说git push到那个origin main上面</raw>
输出: `git push origin main`

输入: <raw>我觉得有三个问题啊第一就是性能不太好第二是那个界面有点丑然后第三个就是文档太少了</raw>
输出: 我觉得有三个问题：
1. 性能不太好
2. 界面有点丑
3. 文档太少了

输入: <raw>帮我把那个删除按钮的颜色改成红色然后把确认弹窗的文案改成你确定要删除吗</raw>
输出: 把删除按钮的颜色改成红色，把确认弹窗的文案改成"你确定要删除吗？""#;

pub(crate) async fn voice_refine_text_inner(text: String) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let user_content = format!("<raw>{}</raw>", trimmed);
    let messages = vec![
        serde_json::json!({"role": "system", "content": REFINE_SYSTEM_PROMPT}),
        serde_json::json!({"role": "user", "content": user_content}),
    ];

    let config = crate::config::load_global_config();
    let refine_model = config
        .voice_refine_model
        .as_deref()
        .unwrap_or("qwen3.7-max");
    let result = call_ai_chat(messages, Some(refine_model), 0.0, "voice_refine").await?;
    Ok(if result.is_empty() {
        trimmed.to_string()
    } else {
        result.trim().to_string()
    })
}

#[tauri::command]
pub(crate) async fn voice_refine_text(text: String) -> Result<String, String> {
    voice_refine_text_inner(text).await
}

// ==================== AI Commit Message Generation ====================

const COMMIT_MSG_SYSTEM_PROMPT: &str = "\
你是一个 Git commit message 生成器。用户会给你 git diff 信息，你需要生成一个简洁的 commit message。\n\
\n\
规则：\n\
- 使用 Conventional Commits 格式：type(scope): description\n\
- type 可以是：feat, fix, refactor, style, docs, chore, perf, test\n\
- scope 是可选的，表示影响的模块\n\
- description 用中文，简洁描述变更内容\n\
- 只输出一行 commit message，不要加任何解释或额外内容\n\
- 如果变更涉及多个方面，选择最主要的变更来写\n\
\n\
示例：\n\
feat(ui): 添加分支切换按钮\n\
fix(git): 修复推送失败时的错误处理\n\
refactor(backend): 重构工作区状态获取逻辑";

#[tauri::command]
pub(crate) async fn generate_commit_message(diff: String) -> Result<String, String> {
    let trimmed = diff.trim();
    if trimmed.is_empty() {
        return Err("No diff provided".to_string());
    }

    let messages = vec![
        serde_json::json!({"role": "system", "content": COMMIT_MSG_SYSTEM_PROMPT}),
        serde_json::json!({"role": "user", "content": trimmed}),
    ];

    let result = call_ai_chat(messages, None, 0.3, "commit_ai").await?;
    Ok(if result.is_empty() {
        "chore: update".to_string()
    } else {
        result.trim().to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::{HeaderMap, StatusCode},
        routing::{get, post},
        Json, Router,
    };
    use futures_util::{SinkExt, StreamExt};
    use once_cell::sync::Lazy;
    use serde_json::{json, Value};
    use serial_test::serial;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex, MutexGuard};
    use std::time::Duration;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    static VOICE_EVENT_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock_voice_event_tests() -> MutexGuard<'static, ()> {
        VOICE_EVENT_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    struct VoiceSessionGuard {
        previous: Option<VoiceSession>,
    }

    impl VoiceSessionGuard {
        fn isolated() -> Self {
            let previous = {
                let mut session = VOICE_SESSION
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                session.take()
            };
            Self { previous }
        }
    }

    impl Drop for VoiceSessionGuard {
        fn drop(&mut self) {
            let mut session = VOICE_SESSION
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *session = self.previous.take();
        }
    }

    struct ConfigCacheGuard {
        previous: Option<crate::types::GlobalConfig>,
        _lock: FileLockGuard,
    }

    impl ConfigCacheGuard {
        fn with_global_config(config: crate::types::GlobalConfig) -> Self {
            let lock = FileLockGuard::acquire();
            let previous = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(config))
            };
            Self {
                previous,
                _lock: lock,
            }
        }

        fn with_dashscope(base_url: String, api_key: &str) -> Self {
            let mut config = crate::types::GlobalConfig::default();
            config.dashscope_api_key = Some(api_key.to_string());
            config.voice_refine_base_url = Some(base_url);
            Self::with_global_config(config)
        }
    }

    impl Drop for ConfigCacheGuard {
        fn drop(&mut self) {
            let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous.take();
        }
    }

    struct FileLockGuard {
        path: PathBuf,
    }

    impl FileLockGuard {
        fn acquire() -> Self {
            let path = std::env::temp_dir().join("worktree-manager-global-config-cache.lock");
            for _ in 0..500 {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                    Err(err) => panic!("failed to create test lock {:?}: {}", path, err),
                }
            }
            panic!("timed out waiting for test lock {:?}", path);
        }
    }

    impl Drop for FileLockGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }

    struct TempHomeGuard {
        previous_home: Option<std::ffi::OsString>,
        previous_cache: Option<crate::types::GlobalConfig>,
        _lock: FileLockGuard,
        _temp_dir: tempfile::TempDir,
    }

    impl TempHomeGuard {
        fn new() -> Self {
            let lock = FileLockGuard::acquire();
            let temp_dir = tempfile::tempdir().expect("create temp home");
            let previous_home = std::env::var_os("HOME");
            let previous_cache = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *cache)
            };
            std::env::set_var("HOME", temp_dir.path());
            Self {
                previous_home,
                previous_cache,
                _lock: lock,
                _temp_dir: temp_dir,
            }
        }
    }

    impl Drop for TempHomeGuard {
        fn drop(&mut self) {
            match &self.previous_home {
                Some(home) => std::env::set_var("HOME", home),
                None => std::env::remove_var("HOME"),
            }
            let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous_cache.take();
        }
    }

    #[derive(Clone, Debug, Default)]
    struct HttpCapture {
        authorization: Option<String>,
        content_type: Option<String>,
        body: Option<Value>,
    }

    fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    }

    async fn spawn_models_server(
        status: StatusCode,
        response: Value,
        captures: Arc<Mutex<Vec<HttpCapture>>>,
    ) -> Result<String, String> {
        let app = Router::new()
            .route(
                "/models",
                get(
                    move |headers: HeaderMap,
                          State(captures): State<Arc<Mutex<Vec<HttpCapture>>>>| {
                        let response = response.clone();
                        async move {
                        captures
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .push(HttpCapture {
                                authorization: header_value(&headers, "authorization"),
                                content_type: header_value(&headers, "content-type"),
                                body: None,
                            });
                        (status, Json(response))
                        }
                    },
                ),
            )
            .with_state(captures);
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(err) => return Err(format!("local bind unavailable: {}", err)),
        };
        let addr = listener.local_addr().expect("models addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(format!("http://{}", addr))
    }

    async fn spawn_chat_server(
        status: StatusCode,
        response: Value,
        captures: Arc<Mutex<Vec<HttpCapture>>>,
    ) -> Result<String, String> {
        let app = Router::new()
            .route(
                "/chat/completions",
                post(
                    move |headers: HeaderMap,
                          State(captures): State<Arc<Mutex<Vec<HttpCapture>>>>,
                          Json(body): Json<Value>| {
                        let response = response.clone();
                        async move {
                            captures
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner())
                                .push(HttpCapture {
                                    authorization: header_value(&headers, "authorization"),
                                    content_type: header_value(&headers, "content-type"),
                                    body: Some(body),
                                });
                            (status, Json(response))
                        }
                    },
                ),
            )
            .with_state(captures);
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(err) => return Err(format!("local bind unavailable: {}", err)),
        };
        let addr = listener.local_addr().expect("chat addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(format!("http://{}", addr))
    }

    #[derive(Debug, Default)]
    struct WsCapture {
        authorization: Option<String>,
        host: Option<String>,
        text_messages: Vec<Value>,
        binary_messages: Vec<Vec<u8>>,
    }

    async fn spawn_dashscope_ws_server(capture: Arc<Mutex<WsCapture>>) -> Result<String, String> {
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(err) => return Err(format!("local bind unavailable: {}", err)),
        };
        let addr = listener.local_addr().expect("ws addr");
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept ws");
            let capture_for_headers = capture.clone();
            let mut ws = tokio_tungstenite::accept_hdr_async(
                stream,
                move |request: &Request, response: Response| {
                    let mut capture = capture_for_headers
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    capture.authorization = request
                        .headers()
                        .get("authorization")
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_string);
                    capture.host = request
                        .headers()
                        .get("host")
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_string);
                    Ok(response)
                },
            )
            .await
            .expect("handshake ws");

            if let Some(Ok(Message::Text(text))) = ws.next().await {
                capture
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .text_messages
                    .push(serde_json::from_str(&text).expect("run-task json"));
                ws.send(Message::Text(
                    json!({ "header": { "event": "task-started" } })
                        .to_string()
                        .into(),
                ))
                .await
                .expect("send task-started");
            }

            while let Some(message) = ws.next().await {
                match message.expect("ws message") {
                    Message::Binary(data) => {
                        capture
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .binary_messages
                            .push(data.to_vec());
                    }
                    Message::Text(text) => {
                        let value: Value = serde_json::from_str(&text).expect("finish-task json");
                        let action = value["header"]["action"].as_str().map(str::to_string);
                        capture
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .text_messages
                            .push(value);
                        if action.as_deref() == Some("finish-task") {
                            ws.send(Message::Text(
                                json!({
                                    "header": { "event": "result-generated" },
                                    "payload": {
                                        "output": {
                                            "sentence": {
                                                "text": "final text",
                                                "sentence_end": true
                                            }
                                        }
                                    }
                                })
                                .to_string()
                                .into(),
                            ))
                            .await
                            .expect("send result");
                            ws.send(Message::Text(
                                json!({ "header": { "event": "task-finished" } })
                                    .to_string()
                                    .into(),
                            ))
                            .await
                            .expect("send finished");
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        });
        Ok(format!("ws://{}/voice", addr))
    }

    #[serial]
    #[test]
    fn get_event_name_reads_server_event_not_client_action() {
        assert_eq!(
            get_event_name(&json!({ "header": { "event": "task-started" } })),
            "task-started"
        );
        assert_eq!(
            get_event_name(&json!({ "header": { "action": "run-task" } })),
            ""
        );
        assert_eq!(get_event_name(&json!({ "payload": {} })), "");
    }

    #[serial]
    #[test]
    fn voice_send_audio_validates_base64_before_session_lookup() {
        let _session = VoiceSessionGuard::isolated();

        let err = voice_send_audio_inner("not valid base64".to_string()).unwrap_err();

        assert!(err.starts_with("Base64 解码失败:"));
    }

    #[serial]
    #[test]
    fn voice_session_state_reports_inactive_and_stop_is_idempotent() {
        let _session = VoiceSessionGuard::isolated();

        assert!(!voice_is_active_inner().unwrap());
        assert_eq!(voice_stop_inner(), Ok(()));
        assert_eq!(
            voice_send_audio_inner(BASE64.encode([1u8, 2, 3])).unwrap_err(),
            "没有活跃的语音会话"
        );
    }

    #[serial]
    #[test]
    fn voice_session_state_sends_audio_and_stop_signal_when_active() {
        let _session = VoiceSessionGuard::isolated();
        let (audio_tx, mut audio_rx) = mpsc::channel::<Vec<u8>>(1);
        let (stop_tx, stop_rx) = watch::channel(false);
        {
            let mut session = VOICE_SESSION
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *session = Some(VoiceSession { audio_tx, stop_tx });
        }

        assert!(voice_is_active_inner().unwrap());
        voice_send_audio_inner(BASE64.encode([4u8, 5, 6])).unwrap();
        voice_stop_inner().unwrap();
        {
            let mut session = VOICE_SESSION
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *session = None;
        }

        assert_eq!(audio_rx.try_recv().unwrap(), vec![4u8, 5, 6]);
        assert!(*stop_rx.borrow());
    }

    #[serial]
    #[tokio::test]
    async fn async_voice_command_wrappers_delegate_to_inner_functions() {
        let _home = TempHomeGuard::new();
        let _session = VoiceSessionGuard::isolated();

        set_dashscope_api_key("dash-wrapper".to_string())
            .await
            .unwrap();
        set_dashscope_base_url("wss://wrapper.example/ws".to_string())
            .await
            .unwrap();
        set_voice_refine_enabled(false).await.unwrap();
        set_voice_refine_base_url("https://wrapper.example/v1".to_string())
            .await
            .unwrap();
        set_voice_asr_model("asr-wrapper".to_string())
            .await
            .unwrap();
        set_voice_refine_model("refine-wrapper".to_string())
            .await
            .unwrap();
        set_commit_ai_api_key("commit-wrapper".to_string())
            .await
            .unwrap();
        set_commit_ai_enabled(false).await.unwrap();

        assert_eq!(
            get_dashscope_api_key().await.unwrap(),
            Some("dash-wrapper".to_string())
        );
        assert_eq!(
            get_dashscope_base_url().await.unwrap(),
            Some("wss://wrapper.example/ws".to_string())
        );
        assert!(!get_voice_refine_enabled().await.unwrap());
        assert_eq!(
            get_voice_refine_base_url().await.unwrap(),
            Some("https://wrapper.example/v1".to_string())
        );
        assert_eq!(
            get_voice_asr_model().await.unwrap(),
            Some("asr-wrapper".to_string())
        );
        assert_eq!(
            get_voice_refine_model().await.unwrap(),
            Some("refine-wrapper".to_string())
        );
        assert_eq!(
            get_commit_ai_api_key().await.unwrap(),
            Some("commit-wrapper".to_string())
        );
        assert!(!get_commit_ai_enabled().await);
        assert!(voice_is_active().await.unwrap() == false);
        assert!(voice_send_audio("not base64".to_string())
            .await
            .unwrap_err()
            .starts_with("Base64 解码失败:"));
        assert_eq!(voice_stop().await, Ok(()));
        assert_eq!(voice_refine_text("  ".to_string()).await.unwrap(), "");
    }

    #[serial]
    #[tokio::test]
    async fn voice_start_reports_missing_key_and_invalid_websocket_url_before_session_creation() {
        let _session = VoiceSessionGuard::isolated();
        let _missing_config =
            ConfigCacheGuard::with_global_config(crate::types::GlobalConfig::default());

        assert_eq!(
            voice_start(None).await.unwrap_err(),
            "请先在设置中配置 Dashscope API Key"
        );
        drop(_missing_config);

        let mut config = crate::types::GlobalConfig::default();
        config.dashscope_api_key = Some("dash-key".to_string());
        config.dashscope_base_url = Some("http:// bad url".to_string());
        let _invalid_url = ConfigCacheGuard::with_global_config(config);
        let err = voice_start_inner(Some(44100)).await.unwrap_err();

        assert!(err.starts_with("构建 WebSocket 请求失败:"));
        assert!(!voice_is_active_inner().unwrap());
    }

    #[serial]
    #[tokio::test]
    async fn handle_dashscope_message_emits_result_and_skips_duplicate_final() {
        let _event_lock = lock_voice_event_tests();
        let mut rx = crate::state::VOICE_BROADCAST.subscribe();
        let mut last_final = String::new();
        let message = json!({
            "header": { "event": "result-generated" },
            "payload": {
                "output": {
                    "sentence": {
                        "text": "hello world",
                        "sentence_end": true
                    }
                }
            }
        })
        .to_string();

        handle_dashscope_message(&message, &mut last_final);

        let emitted = tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
            .await
            .unwrap()
            .unwrap();
        let event: Value = serde_json::from_str(&emitted).unwrap();
        assert_eq!(event["event"], "voice-result");
        assert_eq!(event["payload"]["text"], "hello world");
        assert_eq!(event["payload"]["is_final"], true);
        assert_eq!(last_final, "hello world");

        handle_dashscope_message(&message, &mut last_final);
        let duplicate = tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await;
        assert!(duplicate.is_err());
    }

    #[serial]
    #[tokio::test]
    async fn handle_dashscope_message_emits_task_failed_error() {
        let _event_lock = lock_voice_event_tests();
        let mut rx = crate::state::VOICE_BROADCAST.subscribe();
        let mut last_final = String::new();

        handle_dashscope_message(
            &json!({
                "header": {
                    "event": "task-failed",
                    "error_message": "bad credentials"
                }
            })
            .to_string(),
            &mut last_final,
        );

        let emitted = tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
            .await
            .unwrap()
            .unwrap();
        let event: Value = serde_json::from_str(&emitted).unwrap();
        assert_eq!(event["event"], "voice-error");
        assert_eq!(event["payload"]["message"], "bad credentials");
        assert_eq!(last_final, "");
    }

    #[serial]
    #[tokio::test]
    async fn call_ai_chat_reports_missing_local_key_before_request() {
        let _config = ConfigCacheGuard::with_global_config(crate::types::GlobalConfig::default());
        let messages = vec![json!({ "role": "user", "content": "<raw>hello</raw>" })];

        let err = call_ai_chat(messages, Some("qwen-custom"), 0.4, "voice_refine")
            .await
            .unwrap_err();

        assert_eq!(err, "未配置 AI 能力（无云端连接且无本地 API Key）");
    }

    #[serial]
    #[tokio::test]
    async fn call_ai_chat_maps_invalid_base_url_before_network() {
        let _config = ConfigCacheGuard::with_dashscope("://bad-url".to_string(), "dash-key");
        let messages = vec![json!({ "role": "user", "content": "<raw>hello</raw>" })];

        let err = call_ai_chat(messages, Some("qwen-custom"), 0.4, "voice_refine")
            .await
            .unwrap_err();

        assert!(err.starts_with("AI request failed:"));
        assert!(err.contains("builder error"));
    }

    #[serial]
    #[test]
    fn config_setters_persist_values_and_empty_strings_as_none() {
        let _home = TempHomeGuard::new();

        set_dashscope_api_key_inner("dash-key".to_string()).unwrap();
        set_dashscope_base_url_inner("wss://example.test/ws".to_string()).unwrap();
        set_voice_refine_enabled_inner(false).unwrap();
        set_voice_refine_base_url_inner("https://refine.example/v1/".to_string()).unwrap();
        set_voice_asr_model_inner("asr-custom".to_string()).unwrap();
        set_voice_refine_model_inner("refine-custom".to_string()).unwrap();
        set_commit_ai_api_key_inner("commit-key".to_string()).unwrap();
        set_commit_ai_enabled_inner(false).unwrap();

        assert_eq!(
            get_dashscope_api_key_inner().unwrap(),
            Some("dash-key".to_string())
        );
        assert!(check_dashscope_api_key());
        assert_eq!(
            get_dashscope_base_url_inner().unwrap(),
            Some("wss://example.test/ws".to_string())
        );
        assert!(!get_voice_refine_enabled_inner().unwrap());
        assert_eq!(
            get_voice_refine_base_url_inner().unwrap(),
            Some("https://refine.example/v1/".to_string())
        );
        assert_eq!(
            get_voice_asr_model_inner().unwrap(),
            Some("asr-custom".to_string())
        );
        assert_eq!(
            get_voice_refine_model_inner().unwrap(),
            Some("refine-custom".to_string())
        );
        assert_eq!(
            get_commit_ai_api_key_inner().unwrap(),
            Some("commit-key".to_string())
        );
        assert!(check_commit_ai_api_key());
        assert!(!crate::config::load_global_config().commit_ai_enabled);

        set_dashscope_api_key_inner(String::new()).unwrap();
        set_dashscope_base_url_inner(String::new()).unwrap();
        set_voice_refine_base_url_inner(String::new()).unwrap();
        set_voice_asr_model_inner(String::new()).unwrap();
        set_voice_refine_model_inner(String::new()).unwrap();
        set_commit_ai_api_key_inner(String::new()).unwrap();

        assert_eq!(get_dashscope_api_key_inner().unwrap(), None);
        assert!(!check_dashscope_api_key());
        assert_eq!(get_dashscope_base_url_inner().unwrap(), None);
        assert_eq!(get_voice_refine_base_url_inner().unwrap(), None);
        assert_eq!(get_voice_asr_model_inner().unwrap(), None);
        assert_eq!(get_voice_refine_model_inner().unwrap(), None);
        assert_eq!(get_commit_ai_api_key_inner().unwrap(), None);
        assert!(!check_commit_ai_api_key());
    }

    #[serial]
    #[tokio::test]
    async fn list_dashscope_models_sends_bearer_header_and_sorts_ids() {
        let captures = Arc::new(Mutex::new(Vec::new()));
        let Ok(base_url) = spawn_models_server(
            StatusCode::OK,
            json!({
                "data": [
                    { "id": "qwen-b" },
                    { "id": "qwen-a" },
                    { "not_id": "ignored" }
                ]
            }),
            captures.clone(),
        )
        .await
        else {
            // The managed sandbox can deny loopback binds; this test never calls external APIs.
            return;
        };
        let _config = ConfigCacheGuard::with_dashscope(format!("{}/", base_url), "dash-key");

        let models = list_dashscope_models_inner().await.unwrap();

        assert_eq!(models, vec!["qwen-a".to_string(), "qwen-b".to_string()]);
        let capture = captures.lock().unwrap().first().cloned().unwrap();
        assert_eq!(capture.authorization.as_deref(), Some("Bearer dash-key"));
        assert_eq!(capture.body, None);
    }

    #[serial]
    #[tokio::test]
    async fn list_dashscope_models_reports_server_error_body() {
        let captures = Arc::new(Mutex::new(Vec::new()));
        let Ok(base_url) = spawn_models_server(
            StatusCode::UNAUTHORIZED,
            json!({"message": "bad key"}),
            captures,
        )
        .await
        else {
            // The managed sandbox can deny loopback binds; this test never calls external APIs.
            return;
        };
        let _config = ConfigCacheGuard::with_dashscope(base_url, "dash-key");

        let err = list_dashscope_models_inner().await.unwrap_err();

        assert!(err.starts_with("Models API error:"));
        assert!(err.contains("bad key"));
    }

    #[serial]
    #[tokio::test]
    async fn call_ai_chat_posts_request_body_and_parses_response_content() {
        let captures = Arc::new(Mutex::new(Vec::new()));
        let Ok(base_url) = spawn_chat_server(
            StatusCode::OK,
            json!({
                "choices": [
                    { "message": { "content": "refined text" } }
                ]
            }),
            captures.clone(),
        )
        .await
        else {
            // The managed sandbox can deny loopback binds; this test never calls external APIs.
            return;
        };
        let _config = ConfigCacheGuard::with_dashscope(format!("{}/", base_url), "dash-key");
        let messages = vec![json!({"role": "user", "content": "<raw>hello</raw>"})];

        let content = call_ai_chat(messages.clone(), Some("qwen-unit"), 0.25, "voice_refine")
            .await
            .unwrap();

        assert_eq!(content, "refined text");
        let capture = captures.lock().unwrap().first().cloned().unwrap();
        assert_eq!(capture.authorization.as_deref(), Some("Bearer dash-key"));
        assert_eq!(capture.content_type.as_deref(), Some("application/json"));
        let body = capture.body.unwrap();
        assert_eq!(body["model"], "qwen-unit");
        assert_eq!(body["messages"], Value::Array(messages));
        assert_eq!(body["temperature"], 0.25);
    }

    #[serial]
    #[tokio::test]
    async fn call_ai_chat_commit_ai_uses_commit_key_and_dashscope_base_url() {
        let captures = Arc::new(Mutex::new(Vec::new()));
        let Ok(base_url) = spawn_chat_server(
            StatusCode::OK,
            json!({
                "choices": [
                    { "message": { "content": "fix(core): repair path" } }
                ]
            }),
            captures.clone(),
        )
        .await
        else {
            // The managed sandbox can deny loopback binds; this test never calls external APIs.
            return;
        };
        let mut config = crate::types::GlobalConfig::default();
        config.commit_ai_api_key = Some("commit-key".to_string());
        config.dashscope_base_url = Some(format!("{}/", base_url));
        let _config = ConfigCacheGuard::with_global_config(config);

        let content = call_ai_chat(
            vec![json!({"role": "user", "content": "diff"})],
            None,
            0.3,
            "commit_ai",
        )
        .await
        .unwrap();

        assert_eq!(content, "fix(core): repair path");
        let capture = captures.lock().unwrap().first().cloned().unwrap();
        assert_eq!(capture.authorization.as_deref(), Some("Bearer commit-key"));
        assert_eq!(capture.body.unwrap()["model"], "qwen-turbo-latest");
    }

    #[serial]
    #[tokio::test]
    async fn voice_refine_and_commit_generation_handle_empty_inputs_without_network() {
        let _config = ConfigCacheGuard::with_global_config(crate::types::GlobalConfig::default());

        assert_eq!(
            voice_refine_text_inner(" \n\t ".to_string()).await.unwrap(),
            ""
        );
        assert_eq!(
            generate_commit_message(" \n\t ".to_string())
                .await
                .unwrap_err(),
            "No diff provided"
        );
    }

    #[serial]
    #[tokio::test]
    async fn voice_start_send_audio_and_stop_use_dashscope_websocket_protocol() {
        let _event_lock = lock_voice_event_tests();
        let _session = VoiceSessionGuard::isolated();
        let capture = Arc::new(Mutex::new(WsCapture::default()));
        let Ok(ws_url) = spawn_dashscope_ws_server(capture.clone()).await else {
            // The managed sandbox can deny loopback binds; this test never calls external APIs.
            return;
        };
        let mut config = crate::types::GlobalConfig::default();
        config.dashscope_api_key = Some("dash-key".to_string());
        config.dashscope_base_url = Some(ws_url.clone());
        config.voice_asr_model = Some("asr-unit".to_string());
        let _config = ConfigCacheGuard::with_global_config(config);

        voice_start_inner(Some(8000)).await.unwrap();
        assert!(voice_is_active_inner().unwrap());
        assert_eq!(
            voice_start_inner(None).await.unwrap_err(),
            "语音会话已在进行中"
        );
        voice_send_audio_inner(BASE64.encode([9u8, 8, 7])).unwrap();

        // 等待 mock server 实际收到音频帧后再停止，避免 stop 抢先关闭连接导致丢帧（llvm-cov 插桩下更易触发）。
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                {
                    let c = capture
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if !c.binary_messages.is_empty() {
                        break;
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("server receives audio frame");

        voice_stop_inner().unwrap();

        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if !voice_is_active_inner().unwrap() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("voice session stops");

        let capture = capture
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(capture.authorization.as_deref(), Some("Bearer dash-key"));
        assert!(capture
            .host
            .as_deref()
            .unwrap_or("")
            .starts_with("127.0.0.1:"));
        assert_eq!(capture.binary_messages, vec![vec![9u8, 8, 7]]);
        assert_eq!(capture.text_messages[0]["header"]["action"], "run-task");
        assert_eq!(capture.text_messages[0]["payload"]["model"], "asr-unit");
        assert_eq!(
            capture.text_messages[0]["payload"]["parameters"]["sample_rate"],
            8000
        );
        assert_eq!(
            capture.text_messages.last().unwrap()["header"]["action"],
            "finish-task"
        );
    }
}
