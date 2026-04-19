import type {
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalDataEvent,
  TerminalExitEvent
} from '@shared/terminal-types'

interface OraclePickDirectoryResult {
  canceled: boolean
  path?: string
}

interface OracleTerminalBridge {
  platform: NodeJS.Platform
  workspace: {
    pickDirectory(): Promise<OraclePickDirectoryResult>
  }
  terminal: {
    create(request: TerminalCreateRequest): Promise<TerminalCreateResponse>
    write(terminalId: string, data: string): void
    resize(terminalId: string, cols: number, rows: number): void
    close(terminalId: string): Promise<boolean>
    onData(callback: (event: TerminalDataEvent) => void): () => void
    onExit(callback: (event: TerminalExitEvent) => void): () => void
  }
}

declare global {
  interface Window {
    oracleTerminal?: OracleTerminalBridge
  }

  interface ImportMetaEnv {
    readonly VITE_TERMINAL_WS_URL?: string
    readonly VITE_TERMINAL_WS_TOKEN?: string
  }
}

export {}
