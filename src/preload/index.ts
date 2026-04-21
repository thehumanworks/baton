import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentSessionCloseRequest,
  AgentSessionCreateRequest,
  AgentSessionCreateResponse,
  AgentSessionDataEvent,
  AgentSessionExitEvent,
  AgentSessionGetRequest,
  AgentSessionResizeRequest,
  AgentSessionSummary,
  AgentSessionWriteRequest,
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalListShellsResponse,
  TerminalResizeRequest,
  TerminalWriteRequest
} from '../shared/terminal-types'
import type { AppPreferences } from '../shared/preferences-types'

type ListenerCleanup = () => void

interface PickDirectoryResult {
  canceled: boolean
  path?: string
}

const api = {
  platform: process.platform,
  window: {
    isFullScreen(): Promise<boolean> {
      return ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>
    },
    onFullScreenChange(callback: (isFullScreen: boolean) => void): ListenerCleanup {
      const listener = (_event: Electron.IpcRendererEvent, isFullScreen: boolean): void =>
        callback(isFullScreen)
      ipcRenderer.on('window:fullscreen-changed', listener)
      return () => ipcRenderer.removeListener('window:fullscreen-changed', listener)
    }
  },
  workspace: {
    pickDirectory(): Promise<PickDirectoryResult> {
      return ipcRenderer.invoke('workspace:pick-directory') as Promise<PickDirectoryResult>
    }
  },
  terminal: {
    create(request: TerminalCreateRequest): Promise<TerminalCreateResponse> {
      return ipcRenderer.invoke('terminal:create', request) as Promise<TerminalCreateResponse>
    },
    write(terminalId: string, data: string): void {
      const payload: TerminalWriteRequest = { terminalId, data }
      ipcRenderer.send('terminal:write', payload)
    },
    resize(terminalId: string, cols: number, rows: number): void {
      const payload: TerminalResizeRequest = { terminalId, cols, rows }
      ipcRenderer.send('terminal:resize', payload)
    },
    close(terminalId: string): Promise<boolean> {
      const payload: TerminalCloseRequest = { terminalId }
      return ipcRenderer.invoke('terminal:close', payload) as Promise<boolean>
    },
    onData(callback: (event: TerminalDataEvent) => void): ListenerCleanup {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent): void => callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit(callback: (event: TerminalExitEvent) => void): ListenerCleanup {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent): void => callback(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    },
    listShells(): Promise<TerminalListShellsResponse> {
      return ipcRenderer.invoke('terminal:list-shells') as Promise<TerminalListShellsResponse>
    }
  },
  agentSession: {
    create(request: AgentSessionCreateRequest): Promise<AgentSessionCreateResponse> {
      return ipcRenderer.invoke('agentSession:create', request) as Promise<AgentSessionCreateResponse>
    },
    list(): Promise<AgentSessionSummary[]> {
      return ipcRenderer.invoke('agentSession:list') as Promise<AgentSessionSummary[]>
    },
    get(sessionId: string): Promise<AgentSessionSummary | null> {
      const payload: AgentSessionGetRequest = { sessionId }
      return ipcRenderer.invoke('agentSession:get', payload) as Promise<AgentSessionSummary | null>
    },
    write(sessionId: string, data: string): void {
      const payload: AgentSessionWriteRequest = { sessionId, data }
      ipcRenderer.send('agentSession:write', payload)
    },
    resize(sessionId: string, cols: number, rows: number): void {
      const payload: AgentSessionResizeRequest = { sessionId, cols, rows }
      ipcRenderer.send('agentSession:resize', payload)
    },
    close(sessionId: string): Promise<boolean> {
      const payload: AgentSessionCloseRequest = { sessionId }
      return ipcRenderer.invoke('agentSession:close', payload) as Promise<boolean>
    },
    onData(callback: (event: AgentSessionDataEvent) => void): ListenerCleanup {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentSessionDataEvent): void => callback(payload)
      ipcRenderer.on('agentSession:data', listener)
      return () => ipcRenderer.removeListener('agentSession:data', listener)
    },
    onExit(callback: (event: AgentSessionExitEvent) => void): ListenerCleanup {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentSessionExitEvent): void => callback(payload)
      ipcRenderer.on('agentSession:exit', listener)
      return () => ipcRenderer.removeListener('agentSession:exit', listener)
    },
  },
  preferences: {
    get(): Promise<AppPreferences> {
      return ipcRenderer.invoke('preferences:get') as Promise<AppPreferences>
    },
    set(next: AppPreferences): Promise<AppPreferences> {
      return ipcRenderer.invoke('preferences:set', next) as Promise<AppPreferences>
    },
    wasFreshlyCreated(): Promise<boolean> {
      return ipcRenderer.invoke('preferences:was-freshly-created') as Promise<boolean>
    }
  }
}

contextBridge.exposeInMainWorld('baton', api)
