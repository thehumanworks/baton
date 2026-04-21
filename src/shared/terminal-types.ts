export interface TerminalCreateRequest {
  cols: number
  rows: number
  cwd?: string
  shellId?: string
  wslDistro?: string
}

export interface TerminalCreateResponse {
  terminalId: string
  shell: string
  shellId: string
  pid?: number
  cwd?: string
}

export interface ShellDescriptorDTO {
  id: string
  label: string
  kind: 'native' | 'wsl'
  wslDistro?: string
}

export interface TerminalListShellsResponse {
  shells: ShellDescriptorDTO[]
  defaultShellId: string
}

export interface TerminalDataEvent {
  terminalId: string
  data: string
}

export interface TerminalExitEvent {
  terminalId: string
  exitCode: number | null
  signal?: number | null
}

export interface TerminalWriteRequest {
  terminalId: string
  data: string
}

export interface TerminalResizeRequest {
  terminalId: string
  cols: number
  rows: number
}

export interface TerminalCloseRequest {
  terminalId: string
}

export type AgentSessionStatus = 'running' | 'exited' | 'closed'

export interface AgentSessionCreateRequest {
  cols: number
  rows: number
  cwd?: string
  shellId?: string
}

export interface AgentSessionCreateResponse {
  sessionId: string
  shell: string
  shellId: string
  pid?: number
  cwd: string
  status: AgentSessionStatus
  createdAt: number
  startedAt: number
  recentOutput: string
}

export interface AgentSessionSummary {
  sessionId: string
  shell: string
  shellId: string
  pid?: number
  cwd: string
  status: AgentSessionStatus
  createdAt: number
  startedAt: number
  closedAt?: number
  exitCode?: number | null
  signal?: number | null
  recentOutput: string
}

export interface AgentSessionDataEvent {
  sessionId: string
  data: string
}

export interface AgentSessionExitEvent {
  sessionId: string
  exitCode: number | null
  signal?: number | null
}

export interface AgentSessionWriteRequest {
  sessionId: string
  data: string
}

export interface AgentSessionResizeRequest {
  sessionId: string
  cols: number
  rows: number
}

export interface AgentSessionCloseRequest {
  sessionId: string
}

export interface AgentSessionGetRequest {
  sessionId: string
}
