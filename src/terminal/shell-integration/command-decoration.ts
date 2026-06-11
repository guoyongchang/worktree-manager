// src/terminal/shell-integration/command-decoration.ts

import type { Terminal, ITerminalAddon, IDecoration } from '@xterm/xterm'
import type { CommandDetection } from './command-detection'
import type { CommandInfo, Unsubscribe } from './types'
import { CommandState } from './types'

const COLORS = {
  executing: '#9ca3af',
  success: '#22c55e',
  failure: '#ef4444',
} as const

function getColor(command: CommandInfo): string {
  if (command.state === CommandState.Executing) return COLORS.executing
  if (command.state === CommandState.Finished && command.exitCode === 0) return COLORS.success
  return COLORS.failure
}

export class CommandDecorationAddon implements ITerminalAddon {
  private terminal: Terminal | null = null
  private decorations = new Map<CommandInfo, IDecoration>()
  private unsubscribes: Unsubscribe[] = []

  constructor(private commandDetection: CommandDetection) {}

  activate(terminal: Terminal): void {
    this.terminal = terminal

    this.unsubscribes.push(
      this.commandDetection.onCommandStarted.on((cmd) => this.addDecoration(cmd)),
    )
    this.unsubscribes.push(
      this.commandDetection.onCommandFinished.on((cmd) => this.updateDecoration(cmd)),
    )
  }

  private addDecoration(command: CommandInfo): void {
    if (!this.terminal) return

    const decoration = this.terminal.registerDecoration({
      marker: command.marker,
      anchor: 'left',
      width: 1,
      overviewRulerOptions: {
        color: getColor(command),
        position: 'left',
      },
    })

    if (!decoration) return

    decoration.onRender((element) => {
      element.style.width = '6px'
      element.style.height = '6px'
      element.style.borderRadius = '50%'
      element.style.backgroundColor = getColor(command)
      element.style.marginLeft = '2px'
      element.style.marginTop = '5px'
      element.style.pointerEvents = 'none'
    })

    decoration.onDispose(() => {
      this.decorations.delete(command)
    })

    this.decorations.set(command, decoration)
  }

  private updateDecoration(command: CommandInfo): void {
    const decoration = this.decorations.get(command)
    if (!decoration) return

    // Update overview ruler color
    decoration.options = {
      overviewRulerOptions: {
        color: getColor(command),
        position: 'left',
      },
    }

    // Update dot color if element is already rendered
    if (decoration.element) {
      decoration.element.style.backgroundColor = getColor(command)
    }
  }

  dispose(): void {
    for (const unsub of this.unsubscribes) {
      unsub()
    }
    this.unsubscribes = []
    for (const decoration of this.decorations.values()) {
      decoration.dispose()
    }
    this.decorations.clear()
    this.terminal = null
  }
}
