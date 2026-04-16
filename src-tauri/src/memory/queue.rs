use crate::memory::types::*;
use crate::state::{MEMORY_QUEUE, MEMORY_QUEUE_BROADCAST};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

fn inbox_dir(vault_path: &str) -> PathBuf {
    Path::new(vault_path).join("memory").join("inbox")
}

fn persist_item(vault_path: &str, item: &MemoryQueueItem) -> Result<(), String> {
    let dir = inbox_dir(vault_path);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create inbox dir: {}", e))?;
    let path = dir.join(format!("{}.json", item.id));
    let json = serde_json::to_string_pretty(item)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write: {}", e))?;
    Ok(())
}

fn remove_persisted(vault_path: &str, id: &str) {
    let path = inbox_dir(vault_path).join(format!("{}.json", id));
    let _ = fs::remove_file(path);
}

pub fn load_from_disk(vault_path: &str) -> Vec<MemoryQueueItem> {
    let dir = inbox_dir(vault_path);
    if !dir.exists() {
        return vec![];
    }

    let mut items = vec![];
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    if let Ok(item) = serde_json::from_str::<MemoryQueueItem>(&content) {
                        items.push(item);
                    }
                }
            }
        }
    }

    items.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    items
}

pub fn submit(payload: QueueSubmitPayload, vault_path: &str) -> Result<String, String> {
    let mut queue = MEMORY_QUEUE.lock().map_err(|e| e.to_string())?;

    // Dedup: replace existing pending item from same session
    queue.retain(|item| {
        !(item.session_id == payload.session_id && item.status == QueueStatus::Pending)
    });

    let id = Uuid::new_v4().to_string();
    let item = MemoryQueueItem {
        id: id.clone(),
        session_id: payload.session_id,
        worktree: payload.worktree,
        conversation: payload.conversation,
        timestamp: payload.timestamp,
        trigger: payload.trigger,
        status: QueueStatus::Pending,
        result: None,
        queued_at: Some(chrono::Utc::now()),
    };

    persist_item(vault_path, &item)?;
    queue.push(item);

    let _ = MEMORY_QUEUE_BROADCAST.send("queue_updated".to_string());
    Ok(id)
}

pub fn list_summaries() -> Result<Vec<QueueItemSummary>, String> {
    let queue = MEMORY_QUEUE.lock().map_err(|e| e.to_string())?;
    Ok(queue.iter().map(|item| item.to_summary()).collect())
}

pub fn get_item(id: &str) -> Result<Option<MemoryQueueItem>, String> {
    let queue = MEMORY_QUEUE.lock().map_err(|e| e.to_string())?;
    Ok(queue.iter().find(|item| item.id == id).cloned())
}

pub fn delete_item(id: &str, vault_path: &str) -> Result<(), String> {
    let mut queue = MEMORY_QUEUE.lock().map_err(|e| e.to_string())?;
    queue.retain(|item| item.id != id);
    remove_persisted(vault_path, id);
    let _ = MEMORY_QUEUE_BROADCAST.send("queue_updated".to_string());
    Ok(())
}

pub fn update_status(
    id: &str,
    status: QueueStatus,
    result: Option<ArchiveResult>,
    vault_path: &str,
) -> Result<(), String> {
    let mut queue = MEMORY_QUEUE.lock().map_err(|e| e.to_string())?;
    if let Some(item) = queue.iter_mut().find(|item| item.id == id) {
        item.status = status;
        item.result = result;
        persist_item(vault_path, item)?;
    }
    let _ = MEMORY_QUEUE_BROADCAST.send("queue_updated".to_string());
    Ok(())
}
