// src/terminal/shell-integration/command-detection.ts

import type { Terminal, IMarker } from '@xterm/xterm'
import { Emitter, CommandState } from './types'
import type { CommandInfo, OscEvent, Unsubscribe } from './types'
import type { OscParser } from './osc-parser'

const MAX_COMMANDS = 500

export class CommandDetection {
  private _commands: CommandInfo[] = []
  private pendingCommandText = ''
  private currentCommand: CommandInfo | null = null
  private promptStartMarker: IMarker | null = null
  private markerCleanups = new Map<IMarker, Unsubscribe>()
  private unsubscribeOsc: Unsubscribe

  readonly onCommandStarted = new Emitter<CommandInfo>()
  readonly onCommandFinished = new Emitter<CommandInfo>()
  readonly onCwdChanged = new Emitter<string>()

  private _currentCwd: string | undefined = undefined

  get commands(): readonly CommandInfo[] {
    return this._commands
  }

  get currentCwd(): string | undefined {
    return this._currentCwd
  }

  constructor(oscParser: OscParser, private terminal: Terminal) {
    this.unsubscribeOsc = oscParser.onEvent.on((event) => this.handleEvent(event))
  }

  private handleEvent(event: OscEvent): void {
    switch (event.type) {
      case 'prompt-start':
        this.onPromptStart()
        break
      case 'prompt-end':
        this.onPromptEnd()
        break
      case 'command-start':
        this.onCommandStart()
        break
      case 'command-finished':
        this.onCommandFinished_(event.exitCode)
        break
      case 'command-text':
        this.onCommandText(event.text)
        break
      case 'property':
        if (event.key === 'Cwd') {
          this.setCwd(event.value)
        }
        break
      case 'cwd-change':
        this.handleOsc7(event.uri)
        break
    }
  }

  private onPromptStart(): void {
    // If we were executing and got a new prompt, the D (command-finished) was lost.
    // Leave the previous command as-is so its state stays Executing.
    this.pendingCommandText = ''
    this.currentCommand = null
    // Save a marker at the prompt line so the decoration dot appears next to the
    // prompt rather than on the first output line (the cursor has already moved
    // down by the time preexec emits OSC 633;C).
    this.promptStartMarker?.dispose()
    this.promptStartMarker = this.terminal.registerMarker(0)
  }

  private onPromptEnd(): void {
    // Tolerant: accept B even if A was missed; nothing extra to do here.
  }

  private onCommandText(text: string): void {
    if (this.currentCommand) {
      // E arrived after C — update the current command directly.
      this.currentCommand.commandText = text
    } else {
      // E arrived before C — buffer it.
      this.pendingCommandText = text
    }
  }

  private onCommandStart(): void {
    // Use the prompt-start marker so the decoration appears on the prompt line,
    // not on the first output line.  Fall back to current cursor if A was missed.
    const marker = this.promptStartMarker ?? this.terminal.registerMarker(0)
    this.promptStartMarker = null
    const command: CommandInfo = {
      marker,
      commandText: this.pendingCommandText,
      state: CommandState.Executing,
      exitCode: undefined,
      startTime: Date.now(),
      endTime: undefined,
    }

    // Listen for marker disposal (e.g. terminal clear) and remove the command.
    const disposable = marker.onDispose(() => {
      const idx = this._commands.indexOf(command)
      if (idx !== -1) {
        this._commands.splice(idx, 1)
      }
      this.markerCleanups.delete(marker)
    })
    // Normalise to a plain Unsubscribe — xterm returns IDisposable, the mock returns a function.
    const unsub: Unsubscribe =
      typeof disposable === 'function' ? disposable : () => disposable.dispose()
    this.markerCleanups.set(marker, unsub)

    this._commands.push(command)
    this.currentCommand = command
    this.pendingCommandText = ''

    // Evict the oldest command(s) if the list exceeds the maximum.
    while (this._commands.length > MAX_COMMANDS) {
      const oldest = this._commands.shift()!
      const cleanup = this.markerCleanups.get(oldest.marker)
      if (cleanup) {
        cleanup()
        this.markerCleanups.delete(oldest.marker)
      }
    }

    this.onCommandStarted.fire(command)
  }

  private onCommandFinished_(exitCode: number): void {
    if (this.currentCommand) {
      this.currentCommand.state = CommandState.Finished
      this.currentCommand.exitCode = exitCode
      this.currentCommand.endTime = Date.now()
      this.onCommandFinished.fire(this.currentCommand)
      this.currentCommand = null
    }
  }

  private setCwd(path: string): void {
    this._currentCwd = path
    this.onCwdChanged.fire(path)
  }

  private handleOsc7(uri: string): void {
    // OSC 7 requires file:// URIs — reject other schemes to prevent CWD corruption.
    try {
      const url = new URL(uri)
      if (url.protocol === 'file:') {
        this.setCwd(url.pathname)
      }
    } catch {
      // Not a valid URL; fall back to using the string as-is if it looks like a path.
      if (uri.startsWith('/')) {
        this.setCwd(uri)
      }
    }
  }

  dispose(): void {
    this.unsubscribeOsc()
    this.promptStartMarker?.dispose()
    this.promptStartMarker = null
    for (const cleanup of this.markerCleanups.values()) {
      cleanup()
    }
    this.markerCleanups.clear()
    this.onCommandStarted.dispose()
    this.onCommandFinished.dispose()
    this.onCwdChanged.dispose()
    this._commands = []
  }
}
