import crypto from 'node:crypto'
import net from 'node:net'
import { spawn } from 'node:child_process'
import type {
  HostClientMessage,
  HostServerMessage,
} from '../shared/session-host-protocol'
import type {
  TerminalAttachResponse,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalDataEvent,
  TerminalExitEvent,
} from '../shared/terminal-types'

interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

type Cleanup = () => void

type Listener<T> = (event: T) => void

interface SessionHostClientOptions {
  endpoint: string
  entryScriptPath: string
}

export class SessionHostClient {
  private socket: net.Socket | null = null
  private connectPromise: Promise<void> | null = null
  private spawnPromise: Promise<void> | null = null
  private readonly pendingCreates = new Map<string, PendingRequest<TerminalCreateResponse>>()
  private readonly pendingAttaches = new Map<string, PendingRequest<TerminalAttachResponse>>()
  private readonly pendingCloses = new Map<string, PendingRequest<boolean>>()
  private readonly dataListeners = new Set<Listener<TerminalDataEvent>>()
  private readonly exitListeners = new Set<Listener<TerminalExitEvent>>()
  private rawBuffer = ''

  constructor(private readonly options: SessionHostClientOptions) {}

  async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = this.connectOrSpawn()
    try {
      await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  async create(request: TerminalCreateRequest): Promise<TerminalCreateResponse> {
    await this.ensureConnected()
    const clientId = crypto.randomUUID()
    const promise = createPending<TerminalCreateResponse>((pending) => {
      this.pendingCreates.set(clientId, pending)
    }, () => this.pendingCreates.delete(clientId))

    this.sendMessage({ type: 'create', clientId, ...request })
    return promise
  }

  async attach(terminalId: string): Promise<TerminalAttachResponse> {
    await this.ensureConnected()
    const clientId = crypto.randomUUID()
    const promise = createPending<TerminalAttachResponse>((pending) => {
      this.pendingAttaches.set(clientId, pending)
    }, () => this.pendingAttaches.delete(clientId))

    this.sendMessage({ type: 'attach', clientId, terminalId })
    return promise
  }

  write(terminalId: string, data: string): void {
    if (data.length > 65536) return
    void this.ensureConnected()
      .then(() => this.sendMessage({ type: 'write', terminalId, data }))
      .catch(() => undefined)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    void this.ensureConnected()
      .then(() => this.sendMessage({ type: 'resize', terminalId, cols, rows }))
      .catch(() => undefined)
  }

  async close(terminalId: string): Promise<boolean> {
    await this.ensureConnected()
    const clientId = crypto.randomUUID()
    const promise = createPending<boolean>((pending) => {
      this.pendingCloses.set(clientId, pending)
    }, () => this.pendingCloses.delete(clientId))

    this.sendMessage({ type: 'close', clientId, terminalId })
    return promise
  }

  onData(listener: Listener<TerminalDataEvent>): Cleanup {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onExit(listener: Listener<TerminalExitEvent>): Cleanup {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  dispose(): void {
    this.socket?.destroy()
    this.socket = null
    this.rejectAllPending(new Error('Session host client disposed'))
  }

  private async connectOrSpawn(): Promise<void> {
    try {
      await this.openSocket()
      return
    } catch {
      await this.spawnHost()
      await this.waitForSocket()
    }
  }

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(this.options.endpoint)
      let settled = false

      const cleanup = (): void => {
        socket.removeListener('connect', onConnect)
        socket.removeListener('error', onError)
      }

      const onConnect = (): void => {
        if (settled) return
        settled = true
        cleanup()
        this.attachSocket(socket)
        resolve()
      }

      const onError = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        socket.destroy()
        reject(error)
      }

      socket.once('connect', onConnect)
      socket.once('error', onError)
    })
  }

  private attachSocket(socket: net.Socket): void {
    this.rawBuffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string | Buffer) => {
      this.rawBuffer += chunk.toString()
      while (true) {
        const newlineIndex = this.rawBuffer.indexOf('\n')
        if (newlineIndex === -1) break
        const line = this.rawBuffer.slice(0, newlineIndex).trim()
        this.rawBuffer = this.rawBuffer.slice(newlineIndex + 1)
        if (!line) continue

        let message: HostServerMessage
        try {
          message = JSON.parse(line) as HostServerMessage
        } catch {
          continue
        }

        this.handleMessage(message)
      }
    })

    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.rejectAllPending(new Error('Session host connection closed'))
    })

    socket.on('error', () => {
      // The close handler owns cleanup and pending rejection.
    })

    this.socket = socket
  }

  private handleMessage(message: HostServerMessage): void {
    if (message.type === 'created') {
      const pending = this.pendingCreates.get(message.clientId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pendingCreates.delete(message.clientId)
      pending.resolve({
        terminalId: message.terminalId,
        shell: message.shell,
        shellId: message.shellId,
        pid: message.pid,
        cwd: message.cwd,
      })
      return
    }

    if (message.type === 'attached') {
      const pending = this.pendingAttaches.get(message.clientId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pendingAttaches.delete(message.clientId)
      pending.resolve({
        terminalId: message.terminalId,
        shell: message.shell,
        shellId: message.shellId,
        pid: message.pid,
        cwd: message.cwd,
        status: message.status,
        exitCode: message.exitCode,
        buffer: message.buffer,
      })
      return
    }

    if (message.type === 'closed') {
      const pending = this.pendingCloses.get(message.clientId)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pendingCloses.delete(message.clientId)
      pending.resolve(message.ok)
      return
    }

    if (message.type === 'data') {
      for (const listener of this.dataListeners) {
        listener({ terminalId: message.terminalId, data: message.data })
      }
      return
    }

    if (message.type === 'exit') {
      for (const listener of this.exitListeners) {
        listener({ terminalId: message.terminalId, exitCode: message.exitCode, signal: message.signal })
      }
      return
    }

    if (message.type === 'error' && message.clientId) {
      const pendingCreate = this.pendingCreates.get(message.clientId)
      if (pendingCreate) {
        clearTimeout(pendingCreate.timeout)
        this.pendingCreates.delete(message.clientId)
        pendingCreate.reject(new Error(message.message))
        return
      }

      const pendingAttach = this.pendingAttaches.get(message.clientId)
      if (pendingAttach) {
        clearTimeout(pendingAttach.timeout)
        this.pendingAttaches.delete(message.clientId)
        pendingAttach.reject(new Error(message.message))
        return
      }

      const pendingClose = this.pendingCloses.get(message.clientId)
      if (pendingClose) {
        clearTimeout(pendingClose.timeout)
        this.pendingCloses.delete(message.clientId)
        pendingClose.reject(new Error(message.message))
      }
    }
  }

  private sendMessage(message: HostClientMessage): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Session host connection is not available')
    }
    this.socket.write(`${JSON.stringify(message)}\n`)
  }

  private async spawnHost(): Promise<void> {
    if (this.spawnPromise) return this.spawnPromise

    this.spawnPromise = new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [this.options.entryScriptPath, '--baton-session-host'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          BATON_SESSION_HOST_ENDPOINT: this.options.endpoint,
        },
      })

      child.once('error', reject)
      child.once('spawn', () => {
        child.removeListener('error', reject)
        child.unref()
        resolve()
      })
    }).finally(() => {
      this.spawnPromise = null
    })

    return this.spawnPromise
  }

  private async waitForSocket(): Promise<void> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await this.openSocket()
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unable to connect to session host')
        await delay(100)
      }
    }

    throw lastError ?? new Error('Unable to connect to session host')
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingCreates.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    for (const pending of this.pendingAttaches.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    for (const pending of this.pendingCloses.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingCreates.clear()
    this.pendingAttaches.clear()
    this.pendingCloses.clear()
  }
}

function createPending<T>(
  register: (pending: PendingRequest<T>) => void,
  unregister: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unregister()
      reject(new Error('Timed out waiting for session host'))
    }, 10_000)

    register({ resolve, reject, timeout })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
