export interface HostCreateRequest {
  type: 'create'
  clientId: string
  cols?: number
  rows?: number
  cwd?: string
  shellId?: string
  wslDistro?: string
}

export interface HostAttachRequest {
  type: 'attach'
  clientId: string
  terminalId: string
}

export interface HostWriteRequest {
  type: 'write'
  terminalId: string
  data: string
}

export interface HostResizeRequest {
  type: 'resize'
  terminalId: string
  cols?: number
  rows?: number
}

export interface HostCloseRequest {
  type: 'close'
  clientId: string
  terminalId: string
}

export type HostClientMessage =
  | HostCreateRequest
  | HostAttachRequest
  | HostWriteRequest
  | HostResizeRequest
  | HostCloseRequest

export interface HostCreatedMessage {
  type: 'created'
  clientId: string
  terminalId: string
  shell: string
  shellId: string
  pid?: number
  cwd?: string
}

export interface HostAttachedMessage {
  type: 'attached'
  clientId: string
  terminalId: string
  shell: string
  shellId: string
  pid?: number
  cwd?: string
  status: 'running' | 'exited'
  exitCode: number | null
  buffer: string
}

export interface HostClosedMessage {
  type: 'closed'
  clientId: string
  ok: boolean
}

export interface HostDataMessage {
  type: 'data'
  terminalId: string
  data: string
}

export interface HostExitMessage {
  type: 'exit'
  terminalId: string
  exitCode: number | null
  signal?: number | null
}

export interface HostErrorMessage {
  type: 'error'
  clientId?: string
  message: string
}

export type HostServerMessage =
  | HostCreatedMessage
  | HostAttachedMessage
  | HostClosedMessage
  | HostDataMessage
  | HostExitMessage
  | HostErrorMessage
