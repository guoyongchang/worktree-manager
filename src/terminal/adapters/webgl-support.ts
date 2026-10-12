/**
 * xterm's WebglAddon used to paint a blank screen on WebKit (no theme
 * background, no cursor), so this module used to skip every WebKit engine.
 * Re-verified on macOS WKWebView (Tauri 2, macOS 27): WebGL2 renders fine
 * (`webgl2 ok · Apple GPU`), so desktop WebKit now takes WebGL too and only
 * iOS / WebKitGTK keep the DOM renderer.
 *
 * The decision is still gated on a real probe (clear + read back), not the UA
 * alone, and an explicit preference can override it for testing:
 * `localStorage.setItem('wm_terminal_renderer', 'webgl' | 'dom')`.
 *
 * Bump XTERM_ADAPTER_REVISION to remount live Terminal instances after
 * renderer policy changes.
 */
export const XTERM_ADAPTER_REVISION = 4

export const RENDERER_PREFERENCE_KEY = 'wm_terminal_renderer'

export const RENDERER_PREFERENCE_EVENT = 'terminal-renderer-changed'

export type RendererPreference = 'auto' | 'webgl' | 'dom'

export interface WebglProbe {
  supported: boolean
  detail: string
}

let cachedProbe: WebglProbe | null = null

/** Real WebGL2 check: a context that cannot clear and read back is unusable. */
export function probeWebgl2(): WebglProbe {
  if (cachedProbe) return cachedProbe
  cachedProbe = runProbe()
  return cachedProbe
}

function runProbe(): WebglProbe {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    const gl = canvas.getContext('webgl2')
    if (!gl) return { supported: false, detail: 'no webgl2 context' }
    if (gl.isContextLost()) return { supported: false, detail: 'context lost' }
    gl.clearColor(0.2, 0.6, 1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const pixel = new Uint8Array(4)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const rendered = pixel[2] > 200 && pixel[0] < 80 && pixel[3] > 200
    const renderer = rendererName(gl)
    if (!rendered) return { supported: false, detail: `readback mismatch [${Array.from(pixel).join(',')}]` }
    return { supported: true, detail: `webgl2 ok · ${renderer}` }
  } catch (error) {
    return { supported: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function rendererName(gl: WebGL2RenderingContext): string {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    if (info) {
      const unmasked = gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
      if (unmasked) return String(unmasked)
    }
    return String(gl.getParameter(gl.RENDERER))
  } catch {
    return 'unknown'
  }
}

export function rendererPreference(): RendererPreference {
  try {
    const value = localStorage.getItem(RENDERER_PREFERENCE_KEY)
    return value === 'webgl' || value === 'dom' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function setRendererPreference(preference: RendererPreference): void {
  try {
    if (preference === 'auto') localStorage.removeItem(RENDERER_PREFERENCE_KEY)
    else localStorage.setItem(RENDERER_PREFERENCE_KEY, preference)
  } catch {
    // localStorage unavailable: still notify so the UI reflects the attempt
  }
  window.dispatchEvent(new Event(RENDERER_PREFERENCE_EVENT))
}

/** Platforms where WebglAddon still paints blank, so auto mode stays on DOM. */
export function skipsWebglByDefault(ua: string, platform = '', maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true
  if (platform === 'MacIntel' && maxTouchPoints > 1) return true
  return /AppleWebKit/.test(ua) && /Linux/.test(platform)
}

/**
 * auto: WebGL when the probe passes, except on the platforms above.
 * webgl/dom: explicit override, still gated on the probe.
 */
export function shouldUseWebglRenderer(
  ua: string,
  platform = '',
  maxTouchPoints = 0,
  preference: RendererPreference = rendererPreference(),
  probe: WebglProbe = probeWebgl2(),
): boolean {
  if (preference === 'dom') return false
  if (!probe.supported) return false
  if (preference === 'webgl') return true
  return !skipsWebglByDefault(ua, platform, maxTouchPoints)
}
