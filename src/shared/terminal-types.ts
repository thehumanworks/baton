export interface TerminalCreateRequest {
  cols: number
  rows: number
  cwd?: string
  shell?: string
}

export interface TerminalCreateResponse {
  terminalId: string
  shell: string
  pid?: number
  cwd?: string
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
