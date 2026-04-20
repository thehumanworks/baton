import { createWorkspace, type WorkspaceSettings, type WorkspaceState } from './domain'
import { sanitizeThemePreference, type ThemePreference } from './theme'

const STORAGE_KEY = 'baton.state.v1'

export interface PersistedAppState {
  workspaces: WorkspaceState[]
  activeWorkspaceId: string
  sidebarCollapsed: boolean
  themePreference: ThemePreference
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

function sanitizeWorkspace(workspace: WorkspaceState): WorkspaceState {
  return {
    ...workspace,
    viewport: {
      x: Number.isFinite(workspace.viewport?.x) ? workspace.viewport.x : 160,
      y: Number.isFinite(workspace.viewport?.y) ? workspace.viewport.y : 120,
      scale: Number.isFinite(workspace.viewport?.scale) ? workspace.viewport.scale : 1
    },
    settings: sanitizeSettings((workspace as { settings?: unknown }).settings),
    terminals: Array.isArray(workspace.terminals)
      ? workspace.terminals.map((terminal, index) => ({
          ...terminal,
          title: terminal.title || `Terminal ${index + 1}`,
          terminalId: undefined,
          status: 'starting',
          minimized: Boolean(terminal.minimized),
          z: Number.isFinite(terminal.z) ? terminal.z : index + 1
        }))
      : []
  }
}

export function loadAppState(): PersistedAppState {
  const fallbackWorkspace = createWorkspace('Main')

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        workspaces: [fallbackWorkspace],
        activeWorkspaceId: fallbackWorkspace.id,
        sidebarCollapsed: false,
        themePreference: sanitizeThemePreference(undefined)
      }
    }

    const parsed = JSON.parse(raw) as Partial<PersistedAppState>
    const workspaces = Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0
      ? parsed.workspaces.map(sanitizeWorkspace)
      : [fallbackWorkspace]

    const activeWorkspaceId = workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
      ? String(parsed.activeWorkspaceId)
      : workspaces[0].id

    return {
      workspaces,
      activeWorkspaceId,
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      themePreference: sanitizeThemePreference(parsed.themePreference)
    }
  } catch {
    return {
      workspaces: [fallbackWorkspace],
      activeWorkspaceId: fallbackWorkspace.id,
      sidebarCollapsed: false,
      themePreference: sanitizeThemePreference(undefined)
    }
  }
}

export function saveAppState(state: PersistedAppState): void {
  const serializable: PersistedAppState = {
    ...state,
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      terminals: workspace.terminals.map((terminal) => ({
        ...terminal,
        terminalId: undefined,
        status: terminal.status === 'exited' ? 'exited' : 'starting'
      }))
    }))
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable))
}
