// src/terminal/types.ts

export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface TerminalOptions {
  fontSize: number
  fontFamily: string
  theme?: TerminalTheme
  scrollback: number
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  linkHandler?: (uri: string) => void
  onRendererFallback?: () => void
}

export interface TerminalDimensions {
  cols: number
  rows: number
}

export interface Disposable {
  dispose(): void
}

export interface SearchOptions {
  caseSensitive?: boolean
  regex?: boolean
}

export interface TerminalPasteOptions {
  forceBracketed?: boolean
}

/**
 * All methods except mount() and dispose() must be called after mount() resolves.
 * Calling them before mount will silently no-op (optional chaining on internal state).
 */
export interface TerminalAdapter {
  mount(container: HTMLElement, options: TerminalOptions): Promise<void>
  dispose(): void
  write(data: string): void
  paste(data: string, options?: TerminalPasteOptions): void
  onInput(callback: (data: string) => void): Disposable
  onKeyEvent(callback: (event: KeyboardEvent) => boolean): Disposable
  readonly cols: number
  readonly rows: number
  fit(): TerminalDimensions
  resize(cols: number, rows: number): void
  focus(): void
  blur(): void
  clear(): void
  selectAll(): void
  refresh(start: number, end: number): void
  getSelection(): string
  hasSelection(): boolean
  clearSelection(): void
  findNext?(query: string, options?: SearchOptions): boolean
  findPrevious?(query: string, options?: SearchOptions): boolean
  clearSearch?(): void
  scrollLines(lines: number): void
  scrollToBottom(): void
  setMobileKeyboardPolicy(mode: 'none' | 'text'): void

  // Debug info (optional)
  getDebugInfo?(): Record<string, string>

  // Shell integration (optional — only XtermAdapter implements these)
  scrollToCommand?(direction: 'prev' | 'next'): void
  readonly hasShellIntegration?: boolean
  onCommandStarted?(callback: (cmd: unknown) => void): Disposable | undefined
  onCwdChanged?(callback: (cwd: string) => void): Disposable | undefined
}

export interface TerminalAdapterFactory {
  create(): TerminalAdapter
}
