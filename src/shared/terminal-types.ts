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

export interface TerminalAttachRequest {
  terminalId: string
}

export interface TerminalAttachResponse {
  terminalId: string
  shell: string
  shellId: string
  pid?: number
  cwd?: string
  status: 'running' | 'exited'
  exitCode: number | null
  buffer: string
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
