import { describe, expect, it } from 'vitest'

import { shouldUseWebglRenderer, skipsWebglByDefault, type WebglProbe } from '../webgl-support'

const ok: WebglProbe = { supported: true, detail: 'stub ok' }
const broken: WebglProbe = { supported: false, detail: 'stub broken' }

const WK_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const WEBKIT_GTK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'

describe('shouldUseWebglRenderer', () => {
  it('auto uses WebGL on macOS WKWebView when the probe passes', () => {
    expect(shouldUseWebglRenderer(WK_MAC, 'MacIntel', 0, 'auto', ok)).toBe(true)
  })

  it('auto uses WebGL on Chrome and WebView2 when the probe passes', () => {
    expect(shouldUseWebglRenderer(CHROME, 'MacIntel', 0, 'auto', ok)).toBe(true)
    expect(shouldUseWebglRenderer(EDGE, 'Win32', 0, 'auto', ok)).toBe(true)
  })

  it('auto stays on DOM for iOS and WebKitGTK', () => {
    expect(shouldUseWebglRenderer(IPHONE, 'iPhone', 5, 'auto', ok)).toBe(false)
    expect(shouldUseWebglRenderer(WEBKIT_GTK, 'Linux x86_64', 0, 'auto', ok)).toBe(false)
  })

  it('never uses WebGL when the probe fails', () => {
    expect(shouldUseWebglRenderer(WK_MAC, 'MacIntel', 0, 'auto', broken)).toBe(false)
    expect(shouldUseWebglRenderer(CHROME, 'MacIntel', 0, 'webgl', broken)).toBe(false)
  })

  it('webgl override turns WebGL on where auto would skip', () => {
    expect(shouldUseWebglRenderer(IPHONE, 'iPhone', 5, 'webgl', ok)).toBe(true)
  })

  it('dom override always skips WebGL', () => {
    expect(shouldUseWebglRenderer(CHROME, 'MacIntel', 0, 'dom', ok)).toBe(false)
  })
})

describe('skipsWebglByDefault', () => {
  it('detects iPadOS reporting a desktop UA', () => {
    expect(skipsWebglByDefault('Mozilla/5.0', 'MacIntel', 5)).toBe(true)
  })

  it('keeps desktop macOS and Chrome engines on WebGL', () => {
    expect(skipsWebglByDefault(WK_MAC, 'MacIntel', 0)).toBe(false)
    expect(skipsWebglByDefault(CHROME)).toBe(false)
    expect(skipsWebglByDefault(EDGE)).toBe(false)
  })
})
