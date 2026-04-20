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

describe('persistence workspace shell settings', () => {
  let storage: StorageShim
  let restore: () => void

  beforeEach(() => {
    storage = createStorage()
    restore = installStorage(storage)
  })

  afterEach(() => {
    restore()
  })

  test('saveAppState round-trips shellId and wslDistro on WorkspaceSettings', () => {
    const initial = loadAppState()
    const [workspace] = initial.workspaces
    const next = {
      ...initial,
      workspaces: [
        {
          ...workspace,
          settings: {
            ...workspace.settings,
            shellId: 'wsl:Ubuntu',
            wslDistro: 'Ubuntu',
          },
        },
      ],
    }
    saveAppState(next)

    const reloaded = loadAppState()
    expect(reloaded.workspaces[0]!.settings.shellId).toBe('wsl:Ubuntu')
    expect(reloaded.workspaces[0]!.settings.wslDistro).toBe('Ubuntu')
  })

  test('sanitizeSettings discards empty string shellId', () => {
    storage.setItem(
      'baton.state.v1',
      JSON.stringify({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Main',
            viewport: { x: 0, y: 0, scale: 1 },
            terminals: [],
            settings: { shellId: '  ', wslDistro: '' },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeWorkspaceId: 'ws-1',
        sidebarCollapsed: false,
      }),
    )
    const state = loadAppState()
    expect(state.workspaces[0]!.settings.shellId).toBeUndefined()
    expect(state.workspaces[0]!.settings.wslDistro).toBeUndefined()
  })

  test('sanitizeSettings rejects non-string shellId values', () => {
    storage.setItem(
      'baton.state.v1',
      JSON.stringify({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Main',
            viewport: { x: 0, y: 0, scale: 1 },
            terminals: [],
            settings: { shellId: 42, wslDistro: { name: 'Ubuntu' } },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeWorkspaceId: 'ws-1',
        sidebarCollapsed: false,
      }),
    )
    const state = loadAppState()
    expect(state.workspaces[0]!.settings.shellId).toBeUndefined()
    expect(state.workspaces[0]!.settings.wslDistro).toBeUndefined()
  })
})
