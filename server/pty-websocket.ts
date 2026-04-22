import { WebSocket, WebSocketServer } from 'ws'
import * as pty from 'node-pty'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { detectPreferredShellId, resolveShell } from '../src/main/shell-resolver'
import { detectShells } from '../src/main/shell-detection'
import { createTerminalStartCommandInjector } from '../src/shared/terminal-start-command'

interface CreateMessage {
  type: 'create'
  clientId: string
  cols?: number
  rows?: number
  cwd?: string
  shellId?: string
  wslDistro?: string
  startCommand?: string
}

interface WriteMessage {
  type: 'write'
  terminalId: string
  data: string
}

interface ResizeMessage {
  type: 'resize'
  terminalId: string
  cols?: number
  rows?: number
}

interface CloseMessage {
  type: 'close'
  terminalId: string
}

interface ListMessage {
  type: 'list'
  clientId: string
}

type ClientMessage = CreateMessage | WriteMessage | ResizeMessage | CloseMessage | ListMessage

const host = process.env.TERMINAL_WS_HOST || '127.0.0.1'
const port = Number(process.env.TERMINAL_WS_PORT || 8787)
const token = process.env.TERMINAL_WS_TOKEN

const shellRegistry = detectShells()

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function expandHomePrefix(input: string, home: string): string {
  if (input === '~') return home
  if (input.startsWith('~/')) return path.join(home, input.slice(2))
  if (process.platform === 'win32' && input.startsWith('~\\')) {
    return path.join(home, input.slice(2))
  }
  return input
}

function expandEnvVars(input: string): string {
  if (process.platform === 'win32') {
    return input.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? '')
  }
  return input.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced?: string, bare?: string) => {
    const name = braced ?? bare
    if (!name) return ''
    return process.env[name] ?? ''
  })
}

function resolveWorkspaceCwd(requested?: string): string {
  const home = os.homedir()
  if (!requested) return home

  const trimmed = requested.trim()
  if (!trimmed) return home

  const expanded = path.normalize(expandEnvVars(expandHomePrefix(trimmed, home)))
  if (!path.isAbsolute(expanded)) return home

  try {
    const stat = fs.statSync(expanded)
    if (!stat.isDirectory()) return home
  } catch {
    return home
  }

  return expanded
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

const server = new WebSocketServer({ host, port })

if (host !== '127.0.0.1' && !token) {
  console.warn('WARNING: TERMINAL_WS_HOST is not loopback and TERMINAL_WS_TOKEN is unset. This exposes shell access to the network.')
}

server.on('connection', (socket, request) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (token && requestUrl.searchParams.get('token') !== token) {
    socket.close(1008, 'Unauthorized')
    return
  }

  const terminals = new Map<string, pty.IPty>()

  socket.on('message', (raw) => {
    let message: ClientMessage
    try {
      message = JSON.parse(raw.toString()) as ClientMessage
    } catch {
      send(socket, { type: 'error', message: 'Invalid JSON message' })
      return
    }

    if (message.type === 'list') {
      const defaultShellId = detectPreferredShellId({
        platform: process.platform,
        env: process.env,
        registry: shellRegistry,
      })
      send(socket, {
        type: 'listed',
        clientId: message.clientId,
        shells: shellRegistry.map((d) => ({
          id: d.id,
          label: d.label,
          kind: d.kind,
          ...(d.meta?.wslDistro ? { wslDistro: d.meta.wslDistro } : {}),
        })),
        defaultShellId,
      })
      return
    }

    if (message.type === 'create') {
      const terminalId = crypto.randomUUID()
      const cols = clampInteger(message.cols, 10, 500, 100)
      const rows = clampInteger(message.rows, 4, 200, 30)
      const cwd = resolveWorkspaceCwd(message.cwd)

      try {
        const requestedId = message.shellId && message.shellId !== 'auto' ? message.shellId : 'auto'
        if (requestedId !== 'auto' && !shellRegistry.some((d) => d.id === requestedId)) {
          send(socket, {
            type: 'error',
            clientId: message.clientId,
            message: `Unknown shell id "${requestedId}"`,
          })
          return
        }

        const resolved = resolveShell({
          id: requestedId,
          registry: shellRegistry,
          cwd,
          platform: process.platform,
          env: {
            ...process.env,
            HOME: process.env.HOME || os.homedir(),
          },
        })

        const terminal = pty.spawn(resolved.file, resolved.args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: resolved.cwd,
          env: resolved.env,
        })

        const startCommand = typeof message.startCommand === 'string'
          && message.startCommand.trim().length > 0
          ? message.startCommand
          : undefined
        const startupCommandInjector = createTerminalStartCommandInjector(
          (data) => terminal.write(data),
          { startCommand },
        )

        terminals.set(terminalId, terminal)
        terminal.onData((data) => {
          startupCommandInjector?.observeOutput(data)
          send(socket, { type: 'data', terminalId, data })
        })
        terminal.onExit(({ exitCode, signal }) => {
          startupCommandInjector?.dispose()
          terminals.delete(terminalId)
          send(socket, { type: 'exit', terminalId, exitCode, signal })
        })

        send(socket, {
          type: 'created',
          clientId: message.clientId,
          terminalId,
          shell: resolved.descriptor.label,
          shellId: resolved.descriptor.id,
          pid: terminal.pid,
          cwd: resolved.cwd,
        })
      } catch (error) {
        send(socket, {
          type: 'error',
          clientId: message.clientId,
          message: error instanceof Error ? error.message : 'Unable to create terminal'
        })
      }
      return
    }

    if (message.type === 'write') {
      if (typeof message.data === 'string' && message.data.length <= 65536) {
        terminals.get(message.terminalId)?.write(message.data)
      }
      return
    }

    if (message.type === 'resize') {
      const terminal = terminals.get(message.terminalId)
      if (!terminal) return
      terminal.resize(
        clampInteger(message.cols, 10, 500, 100),
        clampInteger(message.rows, 4, 200, 30)
      )
      return
    }

    if (message.type === 'close') {
      const terminal = terminals.get(message.terminalId)
      if (!terminal) return
      try {
        terminal.kill()
      } finally {
        terminals.delete(message.terminalId)
      }
    }
  })

  socket.on('close', () => {
    for (const [, terminal] of terminals) {
      try {
        terminal.kill()
      } catch {
        // Ignore shutdown errors.
      }
    }
    terminals.clear()
  })
})

server.on('listening', () => {
  console.log(`PTY WebSocket server listening on ws://${host}:${port}`)
})
