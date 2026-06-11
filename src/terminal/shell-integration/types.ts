// src/terminal/shell-integration/types.ts

import type { IMarker } from '@xterm/xterm'

/** Command lifecycle state */
export enum CommandState {
  Executing = 'executing',
  Finished = 'finished',
}

/** Information about a single command */
export interface CommandInfo {
  marker: IMarker
  commandText: string
  state: CommandState
  exitCode: number | undefined
  startTime: number | undefined
  endTime: number | undefined
}

/** Events emitted by OscParser */
export type OscEvent =
  | { type: 'prompt-start' }
  | { type: 'prompt-end' }
  | { type: 'command-start' }
  | { type: 'command-finished'; exitCode: number }
  | { type: 'command-text'; text: string }
  | { type: 'property'; key: string; value: string }
  | { type: 'cwd-change'; uri: string }

/** Callback unsubscribe function */
export type Unsubscribe = () => void

/** Minimal event emitter for typed events */
export class Emitter<T> {
  private listeners: Set<(value: T) => void> = new Set()

  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  fire(value: T): void {
    for (const listener of this.listeners) {
      try {
        listener(value)
      } catch (e) {
        console.warn('[Emitter] listener threw:', e)
      }
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}
