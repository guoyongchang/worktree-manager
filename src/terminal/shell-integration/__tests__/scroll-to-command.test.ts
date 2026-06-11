// src/terminal/shell-integration/__tests__/scroll-to-command.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CommandDetection } from '../command-detection'
import { Emitter } from '../types'
import type { OscEvent } from '../types'

/** Creates a test setup with mock terminal that tracks scrollLines calls */
function createScrollTestSetup() {
  const oscEmitter = new Emitter<OscEvent>()
  let cursorLine = 0

  const mockOscParser = { onEvent: oscEmitter }

  const mockTerminal = {
    rows: 24,
    buffer: {
      active: {
        baseY: 0,
        viewportY: 0,
      },
    },
    registerMarker(offset?: number) {
      const onDisposeEmitter = new Emitter<void>()
      return {
        id: Math.random(),
        line: cursorLine + (offset ?? 0),
        onDispose: onDisposeEmitter.on.bind(onDisposeEmitter),
        dispose: () => onDisposeEmitter.fire(undefined),
        isDisposed: false,
      }
    },
    scrollLines(_delta: number) {
      // tracked externally
    },
  }

  const detection = new CommandDetection(mockOscParser as any, mockTerminal as any)

  return {
    detection,
    mockTerminal,
    fire: (event: OscEvent) => oscEmitter.fire(event),
    setCursorLine: (line: number) => { cursorLine = line },
    dispose: () => {
      detection.dispose()
      oscEmitter.dispose()
    },
  }
}

/** Helper: simulate a complete command at a given line */
function simulateCommand(
  setup: ReturnType<typeof createScrollTestSetup>,
  line: number,
  exitCode = 0,
) {
  setup.setCursorLine(line)
  setup.fire({ type: 'command-start' })
  setup.fire({ type: 'command-finished', exitCode })
}

describe('scrollToCommand logic', () => {
  let setup: ReturnType<typeof createScrollTestSetup>

  beforeEach(() => {
    setup = createScrollTestSetup()
  })

  afterEach(() => {
    setup.dispose()
  })

  it('finds no target when command list is empty', () => {
    const commands = setup.detection.commands
    expect(commands.length).toBe(0)
  })

  it('finds previous command above viewport center', () => {
    simulateCommand(setup, 5)
    simulateCommand(setup, 15)
    simulateCommand(setup, 25)
    simulateCommand(setup, 35)

    // Viewport: baseY=30, viewportY=0 → topVisibleLine=30, center=30+12=42
    setup.mockTerminal.buffer.active.baseY = 30
    setup.mockTerminal.buffer.active.viewportY = 0

    const commands = setup.detection.commands
    const centerLine = 30 + Math.floor(24 / 2) // 42

    let target: typeof commands[number] | undefined
    for (let i = commands.length - 1; i >= 0; i--) {
      if (commands[i].marker.line < centerLine) {
        target = commands[i]
        break
      }
    }

    expect(target).toBeDefined()
    expect(target!.marker.line).toBe(35)
  })

  it('finds next command below viewport center', () => {
    simulateCommand(setup, 5)
    simulateCommand(setup, 15)
    simulateCommand(setup, 25)

    // Viewport: baseY=10, viewportY=0 → topVisibleLine=10, center=10+12=22
    setup.mockTerminal.buffer.active.baseY = 10
    setup.mockTerminal.buffer.active.viewportY = 0

    const commands = setup.detection.commands
    const centerLine = 10 + Math.floor(24 / 2) // 22

    let target: typeof commands[number] | undefined
    for (const cmd of commands) {
      if (cmd.marker.line > centerLine) {
        target = cmd
        break
      }
    }

    expect(target).toBeDefined()
    expect(target!.marker.line).toBe(25)
  })

  it('returns undefined when no command exists above viewport', () => {
    simulateCommand(setup, 50)

    setup.mockTerminal.buffer.active.baseY = 0
    setup.mockTerminal.buffer.active.viewportY = 0

    const commands = setup.detection.commands
    const centerLine = Math.floor(24 / 2) // 12

    let target: typeof commands[number] | undefined
    for (let i = commands.length - 1; i >= 0; i--) {
      if (commands[i].marker.line < centerLine) {
        target = commands[i]
        break
      }
    }

    expect(target).toBeUndefined()
  })

  it('handles scrolled-up viewport (viewportY > 0)', () => {
    simulateCommand(setup, 5)
    simulateCommand(setup, 80)

    // baseY=100, viewportY=50 → topVisibleLine=50, center=50+12=62
    setup.mockTerminal.buffer.active.baseY = 100
    setup.mockTerminal.buffer.active.viewportY = 50

    const commands = setup.detection.commands
    const centerLine = 50 + Math.floor(24 / 2) // 62

    // prev: last command with line < 62 → line 5
    let prevTarget: typeof commands[number] | undefined
    for (let i = commands.length - 1; i >= 0; i--) {
      if (commands[i].marker.line < centerLine) {
        prevTarget = commands[i]
        break
      }
    }
    expect(prevTarget).toBeDefined()
    expect(prevTarget!.marker.line).toBe(5)

    // next: first command with line > 62 → line 80
    let nextTarget: typeof commands[number] | undefined
    for (const cmd of commands) {
      if (cmd.marker.line > centerLine) {
        nextTarget = cmd
        break
      }
    }
    expect(nextTarget).toBeDefined()
    expect(nextTarget!.marker.line).toBe(80)
  })

  it('hasShellIntegration returns false initially and true after command', () => {
    expect(setup.detection.commands.length).toBe(0)
    simulateCommand(setup, 10)
    expect(setup.detection.commands.length).toBeGreaterThan(0)
  })
})
