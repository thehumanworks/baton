import { contextBridge, ipcRenderer } from 'electron'
import type {
  TerminalAttachRequest,
  TerminalAttachResponse,
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
    attach(terminalId: string): Promise<TerminalAttachResponse> {
      const payload: TerminalAttachRequest = { terminalId }
      return ipcRenderer.invoke('terminal:attach', payload) as Promise<TerminalAttachResponse>
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
  },
  appState: {
    get(): Promise<unknown | null> {
      return ipcRenderer.invoke('app-state:get') as Promise<unknown | null>
    },
    set(next: unknown): Promise<unknown> {
      return ipcRenderer.invoke('app-state:set', next) as Promise<unknown>
    }
  }
}

contextBridge.exposeInMainWorld('baton', api)
