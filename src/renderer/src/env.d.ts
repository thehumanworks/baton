import type {
  AgentSessionCreateRequest,
  AgentSessionCreateResponse,
  AgentSessionDataEvent,
  AgentSessionExitEvent,
  AgentSessionSummary,
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
  agentSession: {
    /**
     * Create a local agent session in Electron preload code.
     *
     * Example:
     * ```ts
     * const session = await window.baton.agentSession.create({ cols: 120, rows: 30, cwd: '/tmp' })
     * const stopData = window.baton.agentSession.onData(({ sessionId, data }) => {
     *   if (sessionId === session.sessionId) console.log(data)
     * })
     * window.baton.agentSession.write(session.sessionId, 'echo hello\r')
     * ```
     */
    create(request: AgentSessionCreateRequest): Promise<AgentSessionCreateResponse>
    /** Returns all tracked sessions for inspection UIs or reconnection flows. */
    list(): Promise<AgentSessionSummary[]>
    /** Returns the latest summary for one session, or null when it is unknown. */
    get(sessionId: string): Promise<AgentSessionSummary | null>
    /** Writes raw PTY input to a session; send `\r` to submit a shell command. */
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    /** Closes a session and resolves true when a tracked session was closed. */
    close(sessionId: string): Promise<boolean>
    /** Subscribes to streamed PTY output events shaped as `{ sessionId, data }`. */
    onData(callback: (event: AgentSessionDataEvent) => void): () => void
    /** Subscribes to exit events shaped as `{ sessionId, exitCode, signal }`. */
    onExit(callback: (event: AgentSessionExitEvent) => void): () => void
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
