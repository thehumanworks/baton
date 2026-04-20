import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadAppState, saveAppState } from './persistence'

interface StorageShim {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
}

function createStorage(): StorageShim {
  const store = new Map<string, string>()
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value))
    },
    removeItem: (key) => {
      store.delete(key)
    },
    clear: () => store.clear(),
  }
}

function installStorage(storage: StorageShim): () => void {
  const original = globalThis.localStorage
  // @ts-expect-error minimal localStorage shim for tests
  globalThis.localStorage = storage
  return () => {
    if (original) {
      globalThis.localStorage = original
    } else {
      // @ts-expect-error cleanup when the original was undefined
      delete globalThis.localStorage
    }
  }
}

describe('persistence theme preference', () => {
  let storage: StorageShim
  let restore: () => void

  beforeEach(() => {
    storage = createStorage()
    restore = installStorage(storage)
  })

  afterEach(() => {
    restore()
  })

  test('loadAppState defaults themePreference to system when storage is empty', () => {
    const state = loadAppState()
    expect(state.themePreference).toBe('system')
  })

  test('saveAppState round-trips themePreference', () => {
    const initial = loadAppState()
    saveAppState({ ...initial, themePreference: 'light' })
    const reloaded = loadAppState()
    expect(reloaded.themePreference).toBe('light')

    saveAppState({ ...reloaded, themePreference: 'dark' })
    const reloadedDark = loadAppState()
    expect(reloadedDark.themePreference).toBe('dark')
  })

  test('loadAppState falls back to system for unknown themePreference values', () => {
    storage.setItem(
      'baton.state.v1',
      JSON.stringify({
        workspaces: [],
        activeWorkspaceId: '',
        sidebarCollapsed: false,
        themePreference: 'sepia',
      }),
    )
    const state = loadAppState()
    expect(state.themePreference).toBe('system')
  })
})
