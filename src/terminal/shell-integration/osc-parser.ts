// src/terminal/shell-integration/osc-parser.ts

import type { Terminal, ITerminalAddon, IDisposable } from '@xterm/xterm'
import { Emitter } from './types'
import type { OscEvent } from './types'

/**
 * Decode \xHH escape sequences used by shell integration scripts.
 * Handles: \xHH → character, \\ → backslash.
 * Safe to apply to unescaped text (only \x + 2 hex digits are transformed).
 */
export function unescapeOscValue(value: string): string {
  return value.replace(/\\(\\|x([0-9a-f]{2}))/gi, (_match, _op, hex?) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : '\\'
  )
}

export class OscParser implements ITerminalAddon {
  readonly onEvent = new Emitter<OscEvent>()
  private disposables: IDisposable[] = []

  activate(terminal: Terminal): void {
    this.disposables.push(
      terminal.parser.registerOscHandler(633, (data) => {
        this.handleOsc633(data)
        return false // allow other handlers to process too
      }),
    )
    this.disposables.push(
      terminal.parser.registerOscHandler(7, (data) => {
        this.onEvent.fire({ type: 'cwd-change', uri: data })
        return false
      }),
    )
  }

  private handleOsc633(data: string): void {
    const subType = data[0]
    // payload is everything after the first ";"
    const payload = data.length > 1 && data[1] === ';' ? data.slice(2) : ''

    switch (subType) {
      case 'A':
        this.onEvent.fire({ type: 'prompt-start' })
        break
      case 'B':
        this.onEvent.fire({ type: 'prompt-end' })
        break
      case 'C':
        this.onEvent.fire({ type: 'command-start' })
        break
      case 'D': {
        const code = payload ? parseInt(payload, 10) : 0
        this.onEvent.fire({ type: 'command-finished', exitCode: isNaN(code) ? 0 : code })
        break
      }
      case 'E':
        this.onEvent.fire({ type: 'command-text', text: unescapeOscValue(payload) })
        break
      case 'P': {
        const eqIndex = payload.indexOf('=')
        if (eqIndex !== -1) {
          this.onEvent.fire({
            type: 'property',
            key: payload.slice(0, eqIndex),
            value: unescapeOscValue(payload.slice(eqIndex + 1)),
          })
        }
        break
      }
      // Unknown sub-types are silently ignored
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []
    this.onEvent.dispose()
  }
}
