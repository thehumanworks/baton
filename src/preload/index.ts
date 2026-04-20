import { contextBridge, ipcRenderer } from 'electron'
import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalResizeRequest,
  TerminalWriteRequest
} from '../shared/terminal-types'

type ListenerCleanup = () => void

interface PickDirectoryResult {
  canceled: boolean
  path?: string
}

const api = {
  platform: process.platform,
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
    }
  }
}

contextBridge.exposeInMainWorld('baton', api)
