// src/terminal/shell-integration/__tests__/osc-parser.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OscParser } from '../osc-parser'
import type { OscEvent } from '../types'

/**
 * Minimal mock of xterm.js Terminal for testing OscParser.
 * OscParser only uses terminal.parser.registerOscHandler().
 */
function createMockTerminal() {
  const handlers = new Map<number, (data: string) => boolean>()
  return {
    parser: {
      registerOscHandler(ident: number, callback: (data: string) => boolean) {
        handlers.set(ident, callback)
        return { dispose: () => handlers.delete(ident) }
      },
    },
    /** Simulate the terminal receiving an OSC sequence */
    simulateOsc(ident: number, data: string): boolean {
      const handler = handlers.get(ident)
      return handler ? handler(data) : false
    },
    handlers,
  }
}

describe('OscParser', () => {
  let parser: OscParser
  let terminal: ReturnType<typeof createMockTerminal>
  let events: OscEvent[]

  beforeEach(() => {
    parser = new OscParser()
    terminal = createMockTerminal()
    events = []
    parser.onEvent.on((e) => events.push(e))
    parser.activate(terminal as any)
  })

  afterEach(() => {
    parser.dispose()
  })

  it('parses OSC 633;A as prompt-start', () => {
    terminal.simulateOsc(633, 'A')
    expect(events).toEqual([{ type: 'prompt-start' }])
  })

  it('parses OSC 633;B as prompt-end', () => {
    terminal.simulateOsc(633, 'B')
    expect(events).toEqual([{ type: 'prompt-end' }])
  })

  it('parses OSC 633;C as command-start', () => {
    terminal.simulateOsc(633, 'C')
    expect(events).toEqual([{ type: 'command-start' }])
  })

  it('parses OSC 633;D with exit code', () => {
    terminal.simulateOsc(633, 'D;1')
    expect(events).toEqual([{ type: 'command-finished', exitCode: 1 }])
  })

  it('parses OSC 633;D without exit code as 0', () => {
    terminal.simulateOsc(633, 'D')
    expect(events).toEqual([{ type: 'command-finished', exitCode: 0 }])
  })

  it('parses OSC 633;D; (empty) as exit code 0', () => {
    terminal.simulateOsc(633, 'D;')
    expect(events).toEqual([{ type: 'command-finished', exitCode: 0 }])
  })

  it('parses OSC 633;E with command text', () => {
    terminal.simulateOsc(633, 'E;ls -la /tmp')
    expect(events).toEqual([{ type: 'command-text', text: 'ls -la /tmp' }])
  })

  it('parses OSC 633;E with semicolons in command text', () => {
    terminal.simulateOsc(633, 'E;echo "a;b;c"')
    expect(events).toEqual([{ type: 'command-text', text: 'echo "a;b;c"' }])
  })

  it('parses OSC 633;P with key=value property', () => {
    terminal.simulateOsc(633, 'P;Cwd=/home/user')
    expect(events).toEqual([{ type: 'property', key: 'Cwd', value: '/home/user' }])
  })

  it('parses OSC 7 as cwd-change', () => {
    terminal.simulateOsc(7, 'file://hostname/home/user/project')
    expect(events).toEqual([{ type: 'cwd-change', uri: 'file://hostname/home/user/project' }])
  })

  it('ignores unknown OSC 633 sub-types', () => {
    terminal.simulateOsc(633, 'Z;something')
    expect(events).toEqual([])
  })

  it('cleans up handlers on dispose', () => {
    parser.dispose()
    expect(terminal.handlers.size).toBe(0)
  })
})
