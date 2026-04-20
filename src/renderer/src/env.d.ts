import type {
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalListShellsResponse
} from '@shared/terminal-types'
import type { AppPreferences } from '@shared/preferences-types'

interface BatonPickDirectoryResult {
  canceled: boolean
  path?: string
}

interface BatonBridge {
  platform: NodeJS.Platform
  window: {
    isFullScreen(): Promise<boolean>
    onFullScreenChange(callback: (isFullScreen: boolean) => void): () => void
  }
  workspace: {
    pickDirectory(): Promise<BatonPickDirectoryResult>
  }
  terminal: {
    create(request: TerminalCreateRequest): Promise<TerminalCreateResponse>
    write(terminalId: string, data: string): void
    resize(terminalId: string, cols: number, rows: number): void
    close(terminalId: string): Promise<boolean>
    onData(callback: (event: TerminalDataEvent) => void): () => void
    onExit(callback: (event: TerminalExitEvent) => void): () => void
    listShells(): Promise<TerminalListShellsResponse>
  }
  preferences: {
    get(): Promise<AppPreferences>
    set(next: AppPreferences): Promise<AppPreferences>
    wasFreshlyCreated(): Promise<boolean>
  }
}

declare global {
  interface Window {
    baton?: BatonBridge
  }

  interface ImportMetaEnv {
    readonly VITE_TERMINAL_WS_URL?: string
    readonly VITE_TERMINAL_WS_TOKEN?: string
  }
}

export {}
