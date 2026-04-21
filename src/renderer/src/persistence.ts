import { createWorkspace, type WorkspaceSettings, type WorkspaceState } from './domain'
import { sanitizeThemePreference, type ThemePreference } from './theme'

const STORAGE_KEY = 'baton.state.v1'

function sanitizeTerminalId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export interface PersistedAppState {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string
  sidebarCollapsed: boolean
  themePreference: ThemePreference
}

function createFallbackAppState(): PersistedAppState {
  const fallbackWorkspace = createWorkspace('Main')
  return {
    workspaces: [fallbackWorkspace],
    activeWorkspaceId: fallbackWorkspace.id,
    sidebarCollapsed: false,
    themePreference: sanitizeThemePreference(undefined),
  }
}

function sanitizeSettings(raw: unknown): WorkspaceSettings {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const settings: WorkspaceSettings = {}

  if (typeof source.startCommand === 'string') {
    const trimmed = source.startCommand.trim()
    if (trimmed.length > 0) settings.startCommand = trimmed
  }

  if (typeof source.defaultCwd === 'string') {
    const trimmed = source.defaultCwd.trim()
    if (trimmed.length > 0) settings.defaultCwd = trimmed
  }

  if (typeof source.shellId === 'string') {
    const trimmed = source.shellId.trim()
    if (trimmed.length > 0) settings.shellId = trimmed
  }

  if (typeof source.wslDistro === 'string') {
    const trimmed = source.wslDistro.trim()
    if (trimmed.length > 0) settings.wslDistro = trimmed
  }

  return settings
}

function supportsPersistedTerminalReattach(): boolean {
  return Boolean(globalThis.window?.baton?.appState)
}

function sanitizeWorkspace(
  workspace: WorkspaceState,
  options: { persistTerminalIds: boolean },
): WorkspaceState {
  return {
    ...workspace,
    viewport: {
      x: Number.isFinite(workspace.viewport?.x) ? workspace.viewport.x : 160,
      y: Number.isFinite(workspace.viewport?.y) ? workspace.viewport.y : 120,
      scale: Number.isFinite(workspace.viewport?.scale) ? workspace.viewport.scale : 1,
    },
    settings: sanitizeSettings((workspace as { settings?: unknown }).settings),
    terminals: Array.isArray(workspace.terminals)
      ? workspace.terminals.map((terminal, index) => {
          const terminalId = options.persistTerminalIds
            ? sanitizeTerminalId(terminal.terminalId)
            : undefined
          return {
            ...terminal,
            title: terminal.title || `Terminal ${index + 1}`,
            terminalId,
            status: terminalId ? 'starting' : terminal.status === 'exited' ? 'exited' : 'starting',
            minimized: Boolean(terminal.minimized),
            z: Number.isFinite(terminal.z) ? terminal.z : index + 1,
          }
        })
      : [],
  }
}

export function sanitizePersistedAppState(
  raw: unknown,
  options: { persistTerminalIds?: boolean } = {},
): PersistedAppState {
  const fallback = createFallbackAppState()
  if (!raw || typeof raw !== 'object') return fallback

  const persistTerminalIds = options.persistTerminalIds ?? supportsPersistedTerminalReattach()
  const parsed = raw as Partial<PersistedAppState>
  const workspaces = Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0
    ? parsed.workspaces.map((workspace) => sanitizeWorkspace(workspace, { persistTerminalIds }))
    : fallback.workspaces

  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
    ? String(parsed.activeWorkspaceId)
    : workspaces[0].id

  return {
    workspaces,
    activeWorkspaceId,
    sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
    themePreference: sanitizeThemePreference(parsed.themePreference),
  }
}

export function serializeAppState(
  state: PersistedAppState,
  options: { persistTerminalIds?: boolean } = {},
): PersistedAppState {
  const persistTerminalIds = options.persistTerminalIds ?? supportsPersistedTerminalReattach()

  return {
    ...state,
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      terminals: workspace.terminals.map((terminal) => {
        const terminalId = persistTerminalIds
          ? sanitizeTerminalId(terminal.terminalId)
          : undefined
        return {
          ...terminal,
          terminalId,
          status: terminalId ? 'starting' : terminal.status === 'exited' ? 'exited' : 'starting',
        }
      }),
    })),
  }
}

function loadFromLocalStorage(): PersistedAppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createFallbackAppState()
    return sanitizePersistedAppState(JSON.parse(raw) as unknown)
  } catch {
    return createFallbackAppState()
  }
}

function saveToLocalStorage(state: PersistedAppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function loadAppState(): PersistedAppState {
  return loadFromLocalStorage()
}

export async function hydrateAppState(): Promise<PersistedAppState | null> {
  const bridge = globalThis.window?.baton?.appState
  if (!bridge) return null

  try {
    const raw = await bridge.get()
    if (raw === null) return null
    const hydrated = sanitizePersistedAppState(raw)
    saveToLocalStorage(hydrated)
    return hydrated
  } catch {
    return null
  }
}

export function saveAppState(state: PersistedAppState): void {
  const serializable = serializeAppState(state)
  saveToLocalStorage(serializable)

  const bridge = globalThis.window?.baton?.appState
  if (bridge) {
    void bridge.set(serializable).catch(() => {
      // Keep local cache even if the main-process save fails.
    })
  }
}
