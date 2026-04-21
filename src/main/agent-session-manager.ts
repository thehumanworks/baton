import crypto from 'node:crypto'
import os from 'node:os'
import type * as pty from 'node-pty'
import type {
  AgentSessionCreateRequest,
  AgentSessionCreateResponse,
  AgentSessionExitEvent,
  AgentSessionGetRequest,
  AgentSessionSummary,
} from '../shared/terminal-types'
import type { ShellDescriptor } from '../shared/shell-registry'
import { resolveShell } from './shell-resolver'

export interface PtyLike {
  pid?: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number | null; signal?: number | null }) => void): void
}

export interface AgentSessionManagerDeps {
  spawn(file: string, args: string[], options: pty.IPtyForkOptions): PtyLike
  resolveEffectiveShellId(request: AgentSessionCreateRequest): Promise<string>
  resolveWorkspaceCwd(requested?: string): string
  shellRegistry: readonly ShellDescriptor[]
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  now?: () => number
  createId?: () => string
  recentOutputLimit?: number
  onData?: (event: { sessionId: string; data: string }) => void
  onExit?: (event: AgentSessionExitEvent) => void
}

interface ManagedSession {
  pty: PtyLike
  summary: AgentSessionSummary
}

const DEFAULT_RECENT_OUTPUT_LIMIT = 64 * 1024

export class AgentSessionManager {
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly now: () => number
  private readonly createId: () => string
  private readonly recentOutputLimit: number

  constructor(private readonly deps: AgentSessionManagerDeps) {
    this.now = deps.now ?? Date.now
    this.createId = deps.createId ?? crypto.randomUUID
    this.recentOutputLimit = deps.recentOutputLimit ?? DEFAULT_RECENT_OUTPUT_LIMIT
  }

  async create(request: AgentSessionCreateRequest): Promise<AgentSessionCreateResponse> {
    const sessionId = this.createId()
    const cols = clampInteger(request.cols, 10, 500, 100)
    const rows = clampInteger(request.rows, 4, 200, 30)
    const cwd = this.deps.resolveWorkspaceCwd(request.cwd)
    const effectiveId = await this.deps.resolveEffectiveShellId(request)
    const resolved = resolveShell({
      id: effectiveId,
      registry: this.deps.shellRegistry,
      cwd,
      platform: this.deps.platform,
      env: {
        ...this.deps.env,
        HOME: this.deps.env.HOME || os.homedir(),
      },
    })

    const createdAt = this.now()
    const terminal = this.deps.spawn(resolved.file, resolved.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: resolved.cwd,
      env: resolved.env,
    })

    const summary: AgentSessionSummary = {
      sessionId,
      shell: resolved.descriptor.label,
      shellId: resolved.descriptor.id,
      pid: terminal.pid,
      cwd: resolved.cwd,
      status: 'running',
      createdAt,
      startedAt: createdAt,
      recentOutput: '',
    }

    this.sessions.set(sessionId, { pty: terminal, summary })

    terminal.onData((data) => {
      const session = this.sessions.get(sessionId)
      if (!session) return
      session.summary.recentOutput = appendBounded(session.summary.recentOutput, data, this.recentOutputLimit)
      this.deps.onData?.({ sessionId, data })
    })

    terminal.onExit(({ exitCode, signal }) => {
      const session = this.sessions.get(sessionId)
      if (!session) return
      session.summary.status = 'exited'
      session.summary.exitCode = exitCode
      session.summary.signal = signal
      session.summary.closedAt = this.now()
      this.deps.onExit?.({ sessionId, exitCode, signal })
    })

    return cloneSummary(summary)
  }

  list(): AgentSessionSummary[] {
    return [...this.sessions.values()].map(({ summary }) => cloneSummary(summary))
  }

  get(request: AgentSessionGetRequest): AgentSessionSummary | null {
    return this.getById(request.sessionId)
  }

  getById(sessionId: string): AgentSessionSummary | null {
    const session = this.sessions.get(sessionId)
    return session ? cloneSummary(session.summary) : null
  }

  write(sessionId: string, data: string): boolean {
    if (typeof data !== 'string' || data.length > 65536) return false
    const session = this.sessions.get(sessionId)
    if (!session || session.summary.status !== 'running') return false
    session.pty.write(data)
    return true
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.summary.status !== 'running') return false
    session.pty.resize(clampInteger(cols, 10, 500, 100), clampInteger(rows, 4, 200, 30))
    return true
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    try {
      if (session.summary.status === 'running') {
        session.pty.kill()
      }
    } finally {
      session.summary.status = 'closed'
      session.summary.closedAt = session.summary.closedAt ?? this.now()
      this.sessions.delete(sessionId)
    }

    return true
  }

  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.close(sessionId)
    }
  }
}

function cloneSummary(summary: AgentSessionSummary): AgentSessionSummary {
  return { ...summary }
}

function appendBounded(existing: string, chunk: string, limit: number): string {
  const combined = existing + chunk
  if (combined.length <= limit) return combined
  return combined.slice(combined.length - limit)
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}
