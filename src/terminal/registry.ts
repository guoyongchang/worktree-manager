// src/terminal/registry.ts

import type { TerminalAdapter, TerminalAdapterFactory } from './types'

const registry = new Map<string, TerminalAdapterFactory>()
let defaultId: string | null = null

export const TerminalRegistry = {
  register(id: string, factory: TerminalAdapterFactory): void {
    registry.set(id, factory)
  },

  setDefault(id: string): void {
    if (!registry.has(id)) {
      throw new Error(`Terminal adapter "${id}" not registered`)
    }
    defaultId = id
  },

  create(id?: string): TerminalAdapter {
    const targetId = id ?? defaultId
    if (!targetId) {
      throw new Error('No terminal adapter specified and no default set')
    }
    const factory = registry.get(targetId)
    if (!factory) {
      throw new Error(`Terminal adapter "${targetId}" not found`)
    }
    return factory.create()
  },

  list(): string[] {
    return Array.from(registry.keys())
  },
}
