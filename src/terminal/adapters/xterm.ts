// src/terminal/adapters/xterm.ts

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

import type {
  TerminalAdapter,
  TerminalOptions,
  TerminalDimensions,
  Disposable,
  SearchOptions,
  TerminalPasteOptions,
} from '../types'
import { OscParser } from '../shell-integration/osc-parser'
import { CommandDetection } from '../shell-integration/command-detection'
import type { CommandInfo } from '../shell-integration/types'

const XTERM_THEME = {
  background: '#0f172a',
  foreground: '#cbd5e1',
  cursor: '#cbd5e1',
  cursorAccent: '#0f172a',
  selectionBackground: '#334155',
  black: '#1e293b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#f1f5f9',
  brightBlack: '#475569',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
} as const

export class XtermAdapter implements TerminalAdapter {
  private term: Terminal | null = null
  private fitAddon: FitAddon | null = null
  private container: HTMLElement | null = null
  private mobileKeyboardInitialized = false
  private dblclickHandler: (() => void) | null = null
  private oscParser: OscParser | null = null
  private commandDetection: CommandDetection | null = null
  private webglAddon: WebglAddon | null = null
  private searchAddon: SearchAddon | null = null

  get cols(): number {
    return this.term?.cols ?? 80
  }

  get rows(): number {
    return this.term?.rows ?? 24
  }

  async mount(container: HTMLElement, options: TerminalOptions): Promise<void> {
    const term = new Terminal({
      theme: options.theme ? { ...XTERM_THEME, ...options.theme } : XTERM_THEME,
      fontSize: options.fontSize,
      fontFamily: options.fontFamily,
      cursorBlink: options.cursorBlink,
      cursorStyle: options.cursorStyle,
      scrollback: options.scrollback,
      convertEol: true,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    if (options.linkHandler) {
      const handler = options.linkHandler
      const webLinksAddon = new WebLinksAddon((_event, uri) => handler(uri))
      term.loadAddon(webLinksAddon)
    }

    term.open(container)

    // Unicode11: correct CJK character widths
    const unicode11 = new Unicode11Addon()
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'

    // WebGL: GPU-accelerated rendering with fallback
    // Skip on iOS — all iOS browsers use WebKit which silently fails to render
    // WebGL xterm content (loads without error but shows blank screen)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    if (!isIOS) {
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          webglAddon.dispose()
          this.webglAddon = null
          options.onRendererFallback?.()
        })
        term.loadAddon(webglAddon)
        this.webglAddon = webglAddon
      } catch {
        options.onRendererFallback?.()
      }
    }

    this.term = term
    this.fitAddon = fitAddon
    this.container = container

    // Search: terminal content search
    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    this.searchAddon = searchAddon

    // Shell integration: passive OSC 633 parsing
    this.oscParser = new OscParser()
    term.loadAddon(this.oscParser)
    this.commandDetection = new CommandDetection(this.oscParser, term)
  }

  dispose(): void {
    if (this.dblclickHandler && this.container) {
      this.container.removeEventListener('dblclick', this.dblclickHandler)
      this.dblclickHandler = null
    }
    this.commandDetection?.dispose()
    this.commandDetection = null
    this.oscParser?.dispose()
    this.oscParser = null
    this.searchAddon?.dispose()
    this.searchAddon = null
    this.webglAddon?.dispose()
    this.webglAddon = null
    this.term?.dispose()
    this.term = null
    this.fitAddon = null
    this.container = null
  }

  write(data: string): void {
    this.term?.write(data)
  }

  paste(data: string, options?: TerminalPasteOptions): void {
    if (!this.term) return

    if (options?.forceBracketed) {
      const normalized = data.replace(/\r\n|\r|\n/g, '\r')
      this.term.input(`\x1b[200~${normalized}\x1b[201~`, true)
      return
    }

    this.term.paste(data)
  }

  onInput(callback: (data: string) => void): Disposable {
    const disposable = this.term?.onData(callback)
    return { dispose: () => disposable?.dispose() }
  }

  onKeyEvent(callback: (event: KeyboardEvent) => boolean): Disposable {
    this.term?.attachCustomKeyEventHandler(callback)
    return {
      dispose: () => {
        // xterm.js does not support removing a custom key handler,
        // so replace with a pass-through on dispose.
        this.term?.attachCustomKeyEventHandler(() => true)
      },
    }
  }

  fit(): TerminalDimensions {
    try {
      this.fitAddon?.fit()
    } catch {
      // fit() can throw if container has zero dimensions
    }
    return { cols: this.cols, rows: this.rows }
  }

  resize(cols: number, rows: number): void {
    this.term?.resize(cols, rows)
  }

  focus(): void {
    this.term?.focus()
  }

  blur(): void {
    this.term?.blur()
  }

  clear(): void {
    this.term?.clear()
  }

  selectAll(): void {
    this.term?.selectAll()
  }

  refresh(start: number, end: number): void {
    this.term?.refresh(start, end)
  }

  getSelection(): string {
    return this.term?.getSelection() ?? ''
  }

  hasSelection(): boolean {
    return this.term?.hasSelection() ?? false
  }

  clearSelection(): void {
    this.term?.clearSelection()
  }

  scrollLines(lines: number): void {
    this.term?.scrollLines(lines)
  }

  scrollToBottom(): void {
    this.term?.scrollToBottom()
  }

  findNext(query: string, options?: SearchOptions): boolean {
    return this.searchAddon?.findNext(query, {
      caseSensitive: options?.caseSensitive,
      regex: options?.regex,
    }) ?? false
  }

  findPrevious(query: string, options?: SearchOptions): boolean {
    return this.searchAddon?.findPrevious(query, {
      caseSensitive: options?.caseSensitive,
      regex: options?.regex,
    }) ?? false
  }

  clearSearch(): void {
    this.searchAddon?.clearDecorations()
  }

  setMobileKeyboardPolicy(mode: 'none' | 'text'): void {
    if (!this.container) return
    const textarea = this.container.querySelector(
      '.xterm-helper-textarea',
    ) as HTMLTextAreaElement | null
    if (!textarea) return

    textarea.inputMode = mode

    if (mode === 'none' && !this.mobileKeyboardInitialized) {
      this.mobileKeyboardInitialized = true
      this.dblclickHandler = () => {
        textarea.inputMode = 'text'
        textarea.focus()
        textarea.addEventListener('blur', () => {
          textarea.inputMode = 'none'
        }, { once: true })
      }
      this.container.addEventListener('dblclick', this.dblclickHandler)
    }
  }

  getDebugInfo(): Record<string, string> {
    const renderer = this.webglAddon ? 'WebGL' : 'Canvas'
    const unicodeVersion = this.term?.unicode.activeVersion ?? 'unknown'
    const addons: string[] = []
    if (this.webglAddon) addons.push('WebGL')
    addons.push('Unicode11 (v' + unicodeVersion + ')')
    if (this.searchAddon) addons.push('Search')
    if (this.fitAddon) addons.push('FitAddon')
    const fontSize = this.term?.options.fontSize ?? 'unknown'
    const fontFamily = this.term?.options.fontFamily ?? 'unknown'
    return {
      'Renderer': renderer,
      'Font': `${fontFamily} @ ${fontSize}px`,
      'Unicode Version': unicodeVersion,
      'Loaded Add-ons': addons.join(', ') || 'none',
    }
  }

  /** Get detected commands (shell integration feature, not part of TerminalAdapter interface) */
  getCommands(): readonly CommandInfo[] {
    return this.commandDetection?.commands ?? []
  }

  /** Subscribe to command finished events */
  onCommandFinished(callback: (cmd: CommandInfo) => void): Disposable | undefined {
    const unsub = this.commandDetection?.onCommandFinished.on(callback)
    return unsub ? { dispose: unsub } : undefined
  }

  /** Get the current working directory reported by the shell via OSC 7/633 */
  getShellCwd(): string | undefined {
    return this.commandDetection?.currentCwd
  }

  /** Scroll terminal to show the previous/next command */
  scrollToCommand(direction: 'prev' | 'next'): void {
    if (!this.term || !this.commandDetection) return
    const commands = this.commandDetection.commands
    if (commands.length === 0) return

    const buf = this.term.buffer.active
    // In xterm.js 5.x, baseY = total lines scrolled into scrollback,
    // viewportY = lines scrolled up from bottom. Top visible line:
    const topVisibleLine = buf.baseY - buf.viewportY
    const centerLine = topVisibleLine + Math.floor(this.term.rows / 2)

    let target: CommandInfo | undefined
    if (direction === 'prev') {
      for (let i = commands.length - 1; i >= 0; i--) {
        if (commands[i].marker.line < centerLine) {
          target = commands[i]
          break
        }
      }
    } else {
      for (const cmd of commands) {
        if (cmd.marker.line > centerLine) {
          target = cmd
          break
        }
      }
    }

    if (target && target.marker.line >= 0) {
      const scrollDelta = target.marker.line - topVisibleLine
      this.term.scrollLines(scrollDelta)
    }
  }

  /** Whether shell integration is active (has detected at least one command) */
  get hasShellIntegration(): boolean {
    return (this.commandDetection?.commands.length ?? 0) > 0
  }

  /** Subscribe to command started events (used to make hasShellIntegration reactive) */
  onCommandStarted(callback: (cmd: CommandInfo) => void): Disposable | undefined {
    const unsub = this.commandDetection?.onCommandStarted.on(callback)
    return unsub ? { dispose: unsub } : undefined
  }

  /** Subscribe to CWD changes */
  onCwdChanged(callback: (cwd: string) => void): Disposable | undefined {
    const unsub = this.commandDetection?.onCwdChanged.on(callback)
    return unsub ? { dispose: unsub } : undefined
  }
}
