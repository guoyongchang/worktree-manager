/**
 * xterm's WebglAddon loads without error on WebKit but paints a blank screen
 * (no theme background, no cursor). iOS was already skipped for this reason;
 * Tauri macOS/Linux also use WKWebView / WebKitGTK.
 *
 * Bump XTERM_ADAPTER_REVISION to remount live Terminal instances after
 * renderer policy changes.
 */
export const XTERM_ADAPTER_REVISION = 3

export function shouldSkipWebglRenderer(
  ua: string,
  platform = '',
  maxTouchPoints = 0,
): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true
  if (platform === 'MacIntel' && maxTouchPoints > 1) return true
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)
}
