export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

export interface ViewportState {
  x: number
  y: number
  scale: number
}

export interface TerminalWindowState {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  terminalId?: string
  status: TerminalStatus
  exitCode?: number | null
}

export interface WorkspaceSettings {
  startCommand?: string
  defaultCwd?: string
  shellId?: string
  wslDistro?: string
}

export interface WorkspaceState {
  id: string
  name: string
  viewport: ViewportState
  terminals: TerminalWindowState[]
  settings: WorkspaceSettings
  focusMode: boolean
  focusedTerminalId: string | null
  createdAt: number
  updatedAt: number
}

export const DEFAULT_TERMINAL_WIDTH = 760
export const DEFAULT_TERMINAL_HEIGHT = 440
export const MIN_TERMINAL_WIDTH = 360
export const MIN_TERMINAL_HEIGHT = 220
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 3.2

export function uid(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

export function createWorkspace(name: string): WorkspaceState {
  const now = Date.now()

  return {
    id: uid('workspace'),
    name,
    viewport: { x: 160, y: 120, scale: 1 },
    terminals: [],
    settings: {},
    focusMode: false,
    focusedTerminalId: null,
    createdAt: now,
    updatedAt: now
  }
}

export function createTerminalWindow(input: {
  x: number
  y: number
  width?: number
  height?: number
  z: number
  index: number
}): TerminalWindowState {
  return {
    id: uid('terminal-window'),
    title: `Terminal ${input.index}`,
    x: Math.round(input.x),
    y: Math.round(input.y),
    width: Math.round(input.width ?? DEFAULT_TERMINAL_WIDTH),
    height: Math.round(input.height ?? DEFAULT_TERMINAL_HEIGHT),
    z: input.z,
    minimized: false,
    status: 'starting'
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function resolveFocusedTerminalIndex(
  terminals: TerminalWindowState[],
  focusedTerminalId: string | null,
): number {
  if (terminals.length === 0) return -1
  if (!focusedTerminalId) return 0
  const index = terminals.findIndex((terminal) => terminal.id === focusedTerminalId)
  return index === -1 ? 0 : index
}

export function nextFocusedTerminalId(
  terminals: TerminalWindowState[],
  focusedTerminalId: string | null,
  direction: 1 | -1,
): string | null {
  if (terminals.length === 0) return null
  const current = resolveFocusedTerminalIndex(terminals, focusedTerminalId)
  const total = terminals.length
  const nextIndex = (current + direction + total) % total
  return terminals[nextIndex]!.id
}
