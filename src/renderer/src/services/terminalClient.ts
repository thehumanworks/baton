import type {
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalListShellsResponse
} from '@shared/terminal-types'
import { uid } from '../domain'

type Listener<T> = (event: T) => void

type Cleanup = () => void

export interface TerminalClient {
  readonly mode: 'electron' | 'websocket' | 'demo'
  createTerminal(request: TerminalCreateRequest): Promise<TerminalCreateResponse>
  write(terminalId: string, data: string): void
  resize(terminalId: string, cols: number, rows: number): void
  close(terminalId: string): Promise<boolean>
  onData(listener: Listener<TerminalDataEvent>): Cleanup
  onExit(listener: Listener<TerminalExitEvent>): Cleanup
  listShells(): Promise<TerminalListShellsResponse>
}

class ListenerSet<T> {
  private readonly listeners = new Set<Listener<T>>()

  add(listener: Listener<T>): Cleanup {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: T): void {
    for (const listener of this.listeners) listener(event)
  }
}

class ElectronTerminalClient implements TerminalClient {
  readonly mode = 'electron' as const

  createTerminal(request: TerminalCreateRequest): Promise<TerminalCreateResponse> {
    return window.baton!.terminal.create(request)
  }

  write(terminalId: string, data: string): void {
    window.baton!.terminal.write(terminalId, data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    window.baton!.terminal.resize(terminalId, cols, rows)
  }

  close(terminalId: string): Promise<boolean> {
    return window.baton!.terminal.close(terminalId)
  }

  onData(listener: Listener<TerminalDataEvent>): Cleanup {
    return window.baton!.terminal.onData(listener)
  }

  onExit(listener: Listener<TerminalExitEvent>): Cleanup {
    return window.baton!.terminal.onExit(listener)
  }

  listShells(): Promise<TerminalListShellsResponse> {
    return window.baton!.terminal.listShells()
  }
}

interface ServerMessageCreated {
  type: 'created'
  clientId: string
  terminalId: string
  shell: string
  shellId: string
  pid?: number
  cwd?: string
}

interface ServerMessageData {
  type: 'data'
  terminalId: string
  data: string
}

interface ServerMessageExit {
  type: 'exit'
  terminalId: string
  exitCode: number | null
  signal?: number | null
}

interface ServerMessageError {
  type: 'error'
  clientId?: string
  message: string
}

interface ServerMessageListed {
  type: 'listed'
  clientId: string
  shells: TerminalListShellsResponse['shells']
  defaultShellId: string
}

type ServerMessage =
  | ServerMessageCreated
  | ServerMessageData
  | ServerMessageExit
  | ServerMessageError
  | ServerMessageListed

class WebSocketTerminalClient implements TerminalClient {
  readonly mode = 'websocket' as const
  private socket: WebSocket | null = null
  private connecting: Promise<void> | null = null
  private readonly dataListeners = new ListenerSet<TerminalDataEvent>()
  private readonly exitListeners = new ListenerSet<TerminalExitEvent>()
  private readonly pendingCreates = new Map<string, {
    resolve: (response: TerminalCreateResponse) => void
    reject: (error: Error) => void
    timeout: number
  }>()
  private readonly pendingLists = new Map<string, {
    resolve: (response: TerminalListShellsResponse) => void
    reject: (error: Error) => void
    timeout: number
  }>()

  constructor(
    private readonly url: string,
    private readonly token?: string
  ) {}

  async createTerminal(request: TerminalCreateRequest): Promise<TerminalCreateResponse> {
    await this.ensureSocket()

    const clientId = uid('create')
    const promise = new Promise<TerminalCreateResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingCreates.delete(clientId)
        reject(new Error('Timed out waiting for terminal server'))
      }, 10000)

      this.pendingCreates.set(clientId, { resolve, reject, timeout })
    })

    this.send({ type: 'create', clientId, ...request })
    return promise
  }

  write(terminalId: string, data: string): void {
    this.send({ type: 'write', terminalId, data })
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.send({ type: 'resize', terminalId, cols, rows })
  }

  async close(terminalId: string): Promise<boolean> {
    this.send({ type: 'close', terminalId })
    return true
  }

  onData(listener: Listener<TerminalDataEvent>): Cleanup {
    return this.dataListeners.add(listener)
  }

  onExit(listener: Listener<TerminalExitEvent>): Cleanup {
    return this.exitListeners.add(listener)
  }

  async listShells(): Promise<TerminalListShellsResponse> {
    await this.ensureSocket()

    const clientId = uid('list')
    const promise = new Promise<TerminalListShellsResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingLists.delete(clientId)
        reject(new Error('Timed out waiting for shell list'))
      }, 10000)

      this.pendingLists.set(clientId, { resolve, reject, timeout })
    })

    this.send({ type: 'list', clientId })
    return promise
  }

  private async ensureSocket(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.connecting) return this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      const endpoint = new URL(this.url)
      if (this.token) endpoint.searchParams.set('token', this.token)

      const socket = new WebSocket(endpoint.toString())
      this.socket = socket

      socket.addEventListener('open', () => {
        this.connecting = null
        resolve()
      })

      socket.addEventListener('message', (event) => this.handleMessage(event.data))

      socket.addEventListener('close', () => {
        this.socket = null
        this.connecting = null
        for (const [, pending] of this.pendingCreates) {
          window.clearTimeout(pending.timeout)
          pending.reject(new Error('Terminal server connection closed'))
        }
        this.pendingCreates.clear()
        for (const [, pending] of this.pendingLists) {
          window.clearTimeout(pending.timeout)
          pending.reject(new Error('Terminal server connection closed'))
        }
        this.pendingLists.clear()
      })

      socket.addEventListener('error', () => {
        this.connecting = null
        reject(new Error('Unable to connect to terminal server'))
      })
    })

    return this.connecting
  }

  private send(payload: unknown): void {
    const serialized = JSON.stringify(payload)
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(serialized)
      return
    }

    void this.ensureSocket()
      .then(() => this.socket?.send(serialized))
      .catch((error) => console.error(error))
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return

    let message: ServerMessage
    try {
      message = JSON.parse(raw) as ServerMessage
    } catch {
      return
    }

    if (message.type === 'created') {
      const pending = this.pendingCreates.get(message.clientId)
      if (!pending) return
      window.clearTimeout(pending.timeout)
      this.pendingCreates.delete(message.clientId)
      pending.resolve({
        terminalId: message.terminalId,
        shell: message.shell,
        shellId: message.shellId,
        pid: message.pid,
        cwd: message.cwd
      })
      return
    }

    if (message.type === 'listed') {
      const pending = this.pendingLists.get(message.clientId)
      if (!pending) return
      window.clearTimeout(pending.timeout)
      this.pendingLists.delete(message.clientId)
      pending.resolve({ shells: message.shells, defaultShellId: message.defaultShellId })
      return
    }

    if (message.type === 'data') {
      this.dataListeners.emit({ terminalId: message.terminalId, data: message.data })
      return
    }

    if (message.type === 'exit') {
      this.exitListeners.emit({ terminalId: message.terminalId, exitCode: message.exitCode, signal: message.signal })
      return
    }

    if (message.type === 'error' && message.clientId) {
      const pendingCreate = this.pendingCreates.get(message.clientId)
      if (pendingCreate) {
        window.clearTimeout(pendingCreate.timeout)
        this.pendingCreates.delete(message.clientId)
        pendingCreate.reject(new Error(message.message))
        return
      }
      const pendingList = this.pendingLists.get(message.clientId)
      if (pendingList) {
        window.clearTimeout(pendingList.timeout)
        this.pendingLists.delete(message.clientId)
        pendingList.reject(new Error(message.message))
      }
    }
  }
}

class DemoTerminalClient implements TerminalClient {
  readonly mode = 'demo' as const
  private readonly dataListeners = new ListenerSet<TerminalDataEvent>()
  private readonly exitListeners = new ListenerSet<TerminalExitEvent>()
  private readonly lineBuffers = new Map<string, string>()

  async createTerminal(_request: TerminalCreateRequest): Promise<TerminalCreateResponse> {
    const terminalId = uid('demo-terminal')
    this.lineBuffers.set(terminalId, '')

    window.setTimeout(() => {
      this.emit(terminalId, '\x1b[1;36mBaton\x1b[0m browser demo\r\n')
      this.emit(terminalId, 'This renderer is running without Electron or a PTY WebSocket backend.\r\n')
      this.emit(terminalId, 'Type \x1b[33mhelp\x1b[0m. Configure VITE_TERMINAL_WS_URL for real web terminals.\r\n\r\n$ ')
    }, 50)

    return {
      terminalId,
      shell: 'demo',
      shellId: 'demo',
      cwd: '~'
    }
  }

  async listShells(): Promise<TerminalListShellsResponse> {
    return {
      shells: [{ id: 'demo', label: 'Browser demo', kind: 'native' }],
      defaultShellId: 'demo'
    }
  }

  write(terminalId: string, data: string): void {
    if (!this.lineBuffers.has(terminalId)) return

    for (const char of data) {
      if (char === '\r') {
        this.handleCommand(terminalId)
      } else if (char === '\u0003') {
        this.lineBuffers.set(terminalId, '')
        this.emit(terminalId, '^C\r\n$ ')
      } else if (char === '\u007f') {
        const current = this.lineBuffers.get(terminalId) ?? ''
        if (current.length > 0) {
          this.lineBuffers.set(terminalId, current.slice(0, -1))
          this.emit(terminalId, '\b \b')
        }
      } else if (char >= ' ' && char !== '\u007f') {
        this.lineBuffers.set(terminalId, `${this.lineBuffers.get(terminalId) ?? ''}${char}`)
        this.emit(terminalId, char)
      }
    }
  }

  resize(_terminalId: string, _cols: number, _rows: number): void {
    // Browser demo does not need a backing resize operation.
  }

  async close(terminalId: string): Promise<boolean> {
    this.lineBuffers.delete(terminalId)
    this.exitListeners.emit({ terminalId, exitCode: 0 })
    return true
  }

  onData(listener: Listener<TerminalDataEvent>): Cleanup {
    return this.dataListeners.add(listener)
  }

  onExit(listener: Listener<TerminalExitEvent>): Cleanup {
    return this.exitListeners.add(listener)
  }

  private emit(terminalId: string, data: string): void {
    this.dataListeners.emit({ terminalId, data })
  }

  private handleCommand(terminalId: string): void {
    const raw = this.lineBuffers.get(terminalId) ?? ''
    const command = raw.trim()
    this.lineBuffers.set(terminalId, '')
    this.emit(terminalId, '\r\n')

    if (!command) {
      this.emit(terminalId, '$ ')
      return
    }

    const [program, ...args] = command.split(/\s+/)

    if (program === 'help') {
      this.emit(terminalId, [
        'Available demo commands:',
        '  help               show this help',
        '  date               show browser date',
        '  echo <text>        print text',
        '  pwd                print demo directory',
        '  ls                 list demo files',
        '  uname              print demo platform',
        '  clear              clear terminal',
        '  exit               close demo terminal',
        '',
        'For real shell access in web/mobile, run bun run web:terminal.'
      ].join('\r\n') + '\r\n$ ')
      return
    }

    if (program === 'date') {
      this.emit(terminalId, `${new Date().toString()}\r\n$ `)
      return
    }

    if (program === 'echo') {
      this.emit(terminalId, `${args.join(' ')}\r\n$ `)
      return
    }

    if (program === 'pwd') {
      this.emit(terminalId, `/demo/workspace\r\n$ `)
      return
    }

    if (program === 'ls') {
      this.emit(terminalId, `README.md\tpackage.json\tsrc\tserver\r\n$ `)
      return
    }

    if (program === 'uname') {
      this.emit(terminalId, `Browser demo terminal\r\n$ `)
      return
    }

    if (program === 'clear') {
      this.emit(terminalId, '\x1b[2J\x1b[H$ ')
      return
    }

    if (program === 'exit') {
      void this.close(terminalId)
      return
    }

    this.emit(terminalId, `${program}: command not found in demo mode\r\n$ `)
  }
}

export class BufferedTerminalClient implements TerminalClient {
  readonly mode: TerminalClient['mode']
  private readonly buffers = new Map<string, string>()
  private readonly dataListeners = new ListenerSet<TerminalDataEvent>()
  private readonly exitListeners = new ListenerSet<TerminalExitEvent>()
  private readonly maxBufferBytes = 300_000

  constructor(private readonly inner: TerminalClient) {
    this.mode = inner.mode

    inner.onData((event) => {
      const current = this.buffers.get(event.terminalId) ?? ''
      const next = `${current}${event.data}`
      this.buffers.set(event.terminalId, next.length > this.maxBufferBytes ? next.slice(-this.maxBufferBytes) : next)
      this.dataListeners.emit(event)
    })

    inner.onExit((event) => {
      this.exitListeners.emit(event)
    })
  }

  createTerminal(request: TerminalCreateRequest): Promise<TerminalCreateResponse> {
    return this.inner.createTerminal(request).then((response) => {
      if (!this.buffers.has(response.terminalId)) this.buffers.set(response.terminalId, '')
      return response
    })
  }

  write(terminalId: string, data: string): void {
    this.inner.write(terminalId, data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.inner.resize(terminalId, cols, rows)
  }

  close(terminalId: string): Promise<boolean> {
    this.buffers.delete(terminalId)
    return this.inner.close(terminalId)
  }

  onData(listener: Listener<TerminalDataEvent>): Cleanup {
    return this.dataListeners.add(listener)
  }

  onExit(listener: Listener<TerminalExitEvent>): Cleanup {
    return this.exitListeners.add(listener)
  }

  listShells(): Promise<TerminalListShellsResponse> {
    return this.inner.listShells()
  }

  getBuffer(terminalId: string): string {
    return this.buffers.get(terminalId) ?? ''
  }
}

function createBaseTerminalClient(): TerminalClient {
  if (window.baton?.terminal) return new ElectronTerminalClient()

  const wsUrl = import.meta.env.VITE_TERMINAL_WS_URL
  if (wsUrl) return new WebSocketTerminalClient(wsUrl, import.meta.env.VITE_TERMINAL_WS_TOKEN)

  return new DemoTerminalClient()
}

export function createBufferedTerminalClient(): BufferedTerminalClient {
  return new BufferedTerminalClient(createBaseTerminalClient())
}
