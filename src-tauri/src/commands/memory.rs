use crate::memory::{queue, types::*};

#[tauri::command]
pub async fn memory_queue_list() -> Result<Vec<QueueItemSummary>, String> {
    queue::list_summaries()
}

#[tauri::command]
pub async fn memory_queue_get(id: String) -> Result<Option<MemoryQueueItem>, String> {
    queue::get_item(&id)
}

#[tauri::command]
pub async fn memory_queue_delete(id: String) -> Result<(), String> {
    let item = queue::get_item(&id)?;
    match item {
        Some(item) => {
            let vault_path = item.worktree.vault_path.unwrap_or_default();
            queue::delete_item(&id, &vault_path)
        }
        None => Err("Not found".to_string()),
    }
}

#[tauri::command]
pub async fn memory_queue_run(id: String) -> Result<String, String> {
    // Validate item exists and is runnable
    let item = queue::get_item(&id)?
        .ok_or_else(|| "Not found".to_string())?;

    if item.status != QueueStatus::Pending && item.status != QueueStatus::Failed {
        return Err(format!("Item is {:?}, not runnable", item.status));
    }

    // Reset Failed to Pending for retry
    if item.status == QueueStatus::Failed {
        let vault_path = item.worktree.vault_path.clone().unwrap_or_default();
        queue::update_status(&id, QueueStatus::Pending, None, &vault_path)?;
    }

    let id_clone = id.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::memory::executor::run_archive(&id_clone).await {
            log::error!("[Memory] Archive failed for {}: {}", id_clone, e);
        }
    });

    Ok("started".to_string())
}

#[tauri::command]
pub async fn get_memory_settings() -> Result<MemorySettings, String> {
    let config = crate::config::load_global_config();
    Ok(config.memory.unwrap_or_default())
}

#[tauri::command]
pub async fn save_memory_settings(settings: MemorySettings) -> Result<(), String> {
    let mut config = crate::config::load_global_config();
    config.memory = Some(settings);
    crate::config::save_global_config_internal(&config)
}
