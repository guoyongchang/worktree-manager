import { describe, expect, it } from 'vitest'

import { shouldSkipWebglRenderer } from '../webgl-support'

describe('shouldSkipWebglRenderer', () => {
  it('skips Tauri macOS WKWebView', () => {
    expect(
      shouldSkipWebglRenderer(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        'MacIntel',
        0,
      ),
    ).toBe(true)
  })

  it('skips Safari desktop', () => {
    expect(
      shouldSkipWebglRenderer(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      ),
    ).toBe(true)
  })

  it('skips iPhone', () => {
    expect(
      shouldSkipWebglRenderer(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(true)
  })

  it('skips iPadOS desktop-UA', () => {
    expect(shouldSkipWebglRenderer('Mozilla/5.0', 'MacIntel', 5)).toBe(true)
  })

  it('uses WebGL on Chrome macOS', () => {
    expect(
      shouldSkipWebglRenderer(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'MacIntel',
        0,
      ),
    ).toBe(false)
  })

  it('uses WebGL on Edge / Tauri Windows WebView2', () => {
    expect(
      shouldSkipWebglRenderer(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      ),
    ).toBe(false)
  })
})
