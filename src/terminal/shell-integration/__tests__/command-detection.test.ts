// src/terminal/shell-integration/__tests__/command-detection.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CommandDetection } from '../command-detection'
import { Emitter } from '../types'
import type { OscEvent, CommandInfo } from '../types'
import { CommandState } from '../types'

/** Minimal mock of IMarker */
function createMockMarker(line: number) {
  const onDisposeEmitter = new Emitter<void>()
  return {
    id: Math.random(),
    line,
    onDispose: onDisposeEmitter.on.bind(onDisposeEmitter),
    dispose: () => onDisposeEmitter.fire(undefined),
    isDisposed: false,
    _onDisposeEmitter: onDisposeEmitter,
  }
}

/** Creates a CommandDetection with a mock OscParser and mock terminal */
function createTestSetup() {
  const oscEmitter = new Emitter<OscEvent>()
  const markers: ReturnType<typeof createMockMarker>[] = []
  let cursorLine = 0

  const mockOscParser = {
    onEvent: oscEmitter,
  }

  const mockTerminal = {
    registerMarker(offset?: number): ReturnType<typeof createMockMarker> {
      const marker = createMockMarker(cursorLine + (offset ?? 0))
      markers.push(marker)
      return marker
    },
  }

  const detection = new CommandDetection(mockOscParser as any, mockTerminal as any)

  return {
    detection,
    fire: (event: OscEvent) => oscEmitter.fire(event),
    setCursorLine: (line: number) => { cursorLine = line },
    markers,
    dispose: () => {
      detection.dispose()
      oscEmitter.dispose()
    },
  }
}

describe('CommandDetection', () => {
  let setup: ReturnType<typeof createTestSetup>

  beforeEach(() => {
    setup = createTestSetup()
  })

  afterEach(() => {
    setup.dispose()
  })

  it('starts with empty command list', () => {
    expect(setup.detection.commands).toEqual([])
  })

  it('tracks a full command lifecycle: A → B → C → D', () => {
    const finished: CommandInfo[] = []
    setup.detection.onCommandFinished.on((cmd) => finished.push(cmd))

    setup.setCursorLine(5)
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })

    expect(setup.detection.commands).toHaveLength(1)
    expect(setup.detection.commands[0].state).toBe(CommandState.Executing)

    setup.fire({ type: 'command-finished', exitCode: 0 })

    expect(setup.detection.commands[0].state).toBe(CommandState.Finished)
    expect(setup.detection.commands[0].exitCode).toBe(0)
    expect(finished).toHaveLength(1)
  })

  it('records command text from OSC 633;E', () => {
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-text', text: 'ls -la' })
    setup.fire({ type: 'command-start' })

    expect(setup.detection.commands[0].commandText).toBe('ls -la')
  })

  it('records command text from OSC 633;E received after command-start', () => {
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })
    setup.fire({ type: 'command-text', text: 'git status' })

    expect(setup.detection.commands[0].commandText).toBe('git status')
  })

  it('handles failed commands with non-zero exit code', () => {
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })
    setup.fire({ type: 'command-finished', exitCode: 127 })

    expect(setup.detection.commands[0].exitCode).toBe(127)
  })

  it('tolerates missing prompt-start (B without A)', () => {
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })
    setup.fire({ type: 'command-finished', exitCode: 0 })

    expect(setup.detection.commands).toHaveLength(1)
    expect(setup.detection.commands[0].state).toBe(CommandState.Finished)
  })

  it('tolerates missing command-finished (A resets from Executing)', () => {
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })
    // D is missing, next prompt starts
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })
    setup.fire({ type: 'command-finished', exitCode: 0 })

    // First command stays as Executing (no exit code known), second is Finished
    expect(setup.detection.commands).toHaveLength(2)
    expect(setup.detection.commands[1].state).toBe(CommandState.Finished)
  })

  it('handles empty commands (A → B → A, user pressed Enter)', () => {
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    // User presses Enter without typing a command
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })
    setup.fire({ type: 'command-finished', exitCode: 0 })

    expect(setup.detection.commands).toHaveLength(1)
  })

  it('tracks CWD from OSC 633;P;Cwd=...', () => {
    const cwdChanges: string[] = []
    setup.detection.onCwdChanged.on((cwd) => cwdChanges.push(cwd))

    setup.fire({ type: 'property', key: 'Cwd', value: '/home/user/project' })

    expect(setup.detection.currentCwd).toBe('/home/user/project')
    expect(cwdChanges).toEqual(['/home/user/project'])
  })

  it('tracks CWD from OSC 7', () => {
    setup.fire({ type: 'cwd-change', uri: 'file://localhost/home/user/work' })

    expect(setup.detection.currentCwd).toBe('/home/user/work')
  })

  it('evicts oldest commands when exceeding max limit', () => {
    for (let i = 0; i < 502; i++) {
      setup.fire({ type: 'prompt-start' })
      setup.fire({ type: 'prompt-end' })
      setup.fire({ type: 'command-start' })
      setup.fire({ type: 'command-finished', exitCode: 0 })
    }

    expect(setup.detection.commands.length).toBeLessThanOrEqual(500)
  })

  it('removes command when its marker is disposed', () => {
    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })
    setup.fire({ type: 'command-finished', exitCode: 0 })

    expect(setup.detection.commands).toHaveLength(1)

    // Simulate terminal clear — disposes the marker
    setup.markers[0].dispose()

    expect(setup.detection.commands).toHaveLength(0)
  })

  it('fires onCommandStarted when command begins executing', () => {
    const started: CommandInfo[] = []
    setup.detection.onCommandStarted.on((cmd) => started.push(cmd))

    setup.fire({ type: 'prompt-start' })
    setup.fire({ type: 'prompt-end' })
    setup.fire({ type: 'command-start' })

    expect(started).toHaveLength(1)
    expect(started[0].state).toBe(CommandState.Executing)
  })
})
