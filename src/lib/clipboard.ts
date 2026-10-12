/**
 * Clipboard writes run inside WKWebView (Tauri on macOS), where
 * `navigator.clipboard.writeText` rejects with NotAllowedError whenever the
 * document is not focused — focus often sits in another window or in the
 * terminal textarea, so copies fail intermittently.
 *
 * Fall back to the legacy execCommand path, which works from a click handler
 * in WKWebView and needs no permission. Returns whether the text made it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
