import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { hydrateAppState, loadAppState, saveAppState } from './persistence'

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

function installWindowAppStateBridge(bridge: { get: () => Promise<unknown | null>; set: (next: unknown) => Promise<unknown> }): () => void {
  const originalWindow = globalThis.window
  const nextWindow = {
    ...(originalWindow ?? {}),
    baton: {
      ...(originalWindow?.baton ?? {}),
      appState: bridge,
    },
  }

  // @ts-expect-error minimal window shim for tests
  globalThis.window = nextWindow

  return () => {
    if (originalWindow) {
      globalThis.window = originalWindow
    } else {
      // @ts-expect-error cleanup when the original was undefined
      delete globalThis.window
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

describe('persistence app-state bridge hydration', () => {
  let storage: StorageShim
  let restoreStorage: () => void
  let restoreWindow: (() => void) | null = null

  beforeEach(() => {
    storage = createStorage()
    restoreStorage = installStorage(storage)
  })

  afterEach(() => {
    restoreWindow?.()
    restoreWindow = null
    restoreStorage()
  })

  test('hydrateAppState loads Electron app state and refreshes the local cache', async () => {
    restoreWindow = installWindowAppStateBridge({
      async get() {
        return {
          workspaces: [
            {
              id: 'ws-bridge',
              name: 'Recovered',
              viewport: { x: 1, y: 2, scale: 1 },
              terminals: [],
              settings: {},
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          activeWorkspaceId: 'ws-bridge',
          sidebarCollapsed: true,
          themePreference: 'light',
        }
      },
      async set(next: unknown) {
        return next
      },
    })

    const hydrated = await hydrateAppState()
    expect(hydrated?.activeWorkspaceId).toBe('ws-bridge')
    expect(loadAppState().activeWorkspaceId).toBe('ws-bridge')
    expect(loadAppState().themePreference).toBe('light')
  })

  test('saveAppState mirrors the serialised state into the Electron app-state bridge', async () => {
    let captured: unknown = null
    restoreWindow = installWindowAppStateBridge({
      async get() {
        return null
      },
      async set(next: unknown) {
        captured = next
        return next
      },
    })

    const initial = loadAppState()
    saveAppState({
      ...initial,
      themePreference: 'dark',
    })

    await Promise.resolve()
    expect(captured).toMatchObject({ themePreference: 'dark' })
  })
})

describe('persistence workspace shell settings', () => {
  let storage: StorageShim
  let restore: () => void
  let restoreWindow: (() => void) | null = null

  beforeEach(() => {
    storage = createStorage()
    restore = installStorage(storage)
  })

  afterEach(() => {
    restoreWindow?.()
    restoreWindow = null
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

  test('saveAppState strips terminalId on non-Electron runtimes so reload spawns a fresh session', () => {
    const initial = loadAppState()
    const [workspace] = initial.workspaces

    saveAppState({
      ...initial,
      workspaces: [
        {
          ...workspace,
          terminals: [
            {
              id: 'terminal-1',
              title: 'bash · /tmp',
              x: 10,
              y: 20,
              width: 400,
              height: 300,
              z: 1,
              minimized: false,
              terminalId: 'session-123',
              status: 'running',
              exitCode: null,
            },
          ],
        },
      ],
    })

    const reloaded = loadAppState()
    expect(reloaded.workspaces[0]!.terminals[0]!.terminalId).toBeUndefined()
    expect(reloaded.workspaces[0]!.terminals[0]!.status).toBe('starting')
  })

  test('saveAppState preserves terminalId when the Electron app-state bridge is available', () => {
    restoreWindow = installWindowAppStateBridge({
      async get() {
        return null
      },
      async set(next: unknown) {
        return next
      },
    })

    const initial = loadAppState()
    const [workspace] = initial.workspaces

    saveAppState({
      ...initial,
      workspaces: [
        {
          ...workspace,
          terminals: [
            {
              id: 'terminal-1',
              title: 'bash · /tmp',
              x: 10,
              y: 20,
              width: 400,
              height: 300,
              z: 1,
              minimized: false,
              terminalId: 'session-123',
              status: 'running',
              exitCode: null,
            },
          ],
        },
      ],
    })

    const reloaded = loadAppState()
    expect(reloaded.workspaces[0]!.terminals[0]!.terminalId).toBe('session-123')
    expect(reloaded.workspaces[0]!.terminals[0]!.status).toBe('starting')
  })

  test('loadAppState strips saved terminalId on non-Electron runtimes', () => {
    storage.setItem(
      'baton.state.v1',
      JSON.stringify({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Main',
            viewport: { x: 0, y: 0, scale: 1 },
            terminals: [
              {
                id: 'terminal-1',
                title: 'bash · /tmp',
                x: 10,
                y: 20,
                width: 400,
                height: 300,
                z: 1,
                minimized: false,
                terminalId: 'session-restore',
                status: 'running',
                exitCode: 0,
              },
            ],
            settings: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeWorkspaceId: 'ws-1',
        sidebarCollapsed: false,
      }),
    )

    const state = loadAppState()
    expect(state.workspaces[0]!.terminals[0]!.terminalId).toBeUndefined()
    expect(state.workspaces[0]!.terminals[0]!.status).toBe('starting')
  })

  test('loadAppState round-trips focusMode and focusedTerminalId when the terminal still exists', () => {
    restoreWindow = installWindowAppStateBridge({
      async get() {
        return null
      },
      async set(next: unknown) {
        return next
      },
    })

    storage.setItem(
      'baton.state.v1',
      JSON.stringify({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Main',
            viewport: { x: 0, y: 0, scale: 1 },
            focusMode: true,
            focusedTerminalId: 'terminal-keep',
            terminals: [
              {
                id: 'terminal-keep',
                title: 'bash · /tmp',
                x: 10,
                y: 20,
                width: 400,
                height: 300,
                z: 1,
                minimized: false,
                terminalId: 'session-a',
                status: 'running',
                exitCode: null,
              },
            ],
            settings: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeWorkspaceId: 'ws-1',
        sidebarCollapsed: false,
      }),
    )

    const state = loadAppState()
    expect(state.workspaces[0]!.focusMode).toBe(true)
    expect(state.workspaces[0]!.focusedTerminalId).toBe('terminal-keep')
  })

  test('loadAppState clears focusedTerminalId when the referenced terminal is gone', () => {
    storage.setItem(
      'baton.state.v1',
      JSON.stringify({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Main',
            viewport: { x: 0, y: 0, scale: 1 },
            focusMode: true,
            focusedTerminalId: 'terminal-missing',
            terminals: [
              {
                id: 'terminal-present',
                title: 'bash · /tmp',
                x: 0,
                y: 0,
                width: 400,
                height: 300,
                z: 1,
                minimized: false,
                status: 'running',
                exitCode: null,
              },
            ],
            settings: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeWorkspaceId: 'ws-1',
        sidebarCollapsed: false,
      }),
    )

    const state = loadAppState()
    expect(state.workspaces[0]!.focusMode).toBe(true)
    expect(state.workspaces[0]!.focusedTerminalId).toBeNull()
  })

  test('loadAppState defaults focus fields to disabled for legacy persisted workspaces', () => {
    storage.setItem(
      'baton.state.v1',
      JSON.stringify({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Main',
            viewport: { x: 0, y: 0, scale: 1 },
            terminals: [],
            settings: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeWorkspaceId: 'ws-1',
        sidebarCollapsed: false,
      }),
    )

    const state = loadAppState()
    expect(state.workspaces[0]!.focusMode).toBe(false)
    expect(state.workspaces[0]!.focusedTerminalId).toBeNull()
  })

  test('loadAppState preserves saved terminalId and forces reattach on Electron restore', () => {
    restoreWindow = installWindowAppStateBridge({
      async get() {
        return null
      },
      async set(next: unknown) {
        return next
      },
    })

    storage.setItem(
      'baton.state.v1',
      JSON.stringify({
        workspaces: [
          {
            id: 'ws-1',
            name: 'Main',
            viewport: { x: 0, y: 0, scale: 1 },
            terminals: [
              {
                id: 'terminal-1',
                title: 'bash · /tmp',
                x: 10,
                y: 20,
                width: 400,
                height: 300,
                z: 1,
                minimized: false,
                terminalId: 'session-restore',
                status: 'exited',
                exitCode: 0,
              },
            ],
            settings: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        activeWorkspaceId: 'ws-1',
        sidebarCollapsed: false,
      }),
    )

    const state = loadAppState()
    expect(state.workspaces[0]!.terminals[0]!.terminalId).toBe('session-restore')
    expect(state.workspaces[0]!.terminals[0]!.status).toBe('starting')
  })
})
