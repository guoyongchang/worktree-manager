import { check } from '@tauri-apps/plugin-updater';

/**
 * Check if an update is available.
 * Returns the Update object if available, null otherwise.
 * UI presentation is handled by the useUpdater hook and UpdaterDialogs components.
 */
export async function checkUpdateAvailable() {
  try {
    return await check();
  } catch (error) {
    console.error('Failed to check for updates:', error);
    return null;
  }
}
