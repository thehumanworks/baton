import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import * as pty from 'node-pty'
import type { Socket } from 'node:net'
import type { HostClientMessage, HostServerMessage } from '../shared/session-host-protocol'
import {
  createTerminalStartCommandInjector,
  type TerminalStartCommandInjector,
} from '../shared/terminal-start-command'
import { detectShells } from './shell-detection'
import { resolveShell } from './shell-resolver'
import { clampInteger, resolveWorkspaceCwd } from './terminal-runtime'

interface SessionRecord {
  terminalId: string
  shell: string
  shellId: string
  pid?: number
  cwd?: string
  pty?: pty.IPty
  startupCommandInjector?: TerminalStartCommandInjector
  buffer: string
  status: 'running' | 'exited'
  exitCode: number | null
  signal?: number | null
  attachments: Set<Socket>
}

const MAX_BUFFER_BYTES = 300_000
const idleExitMsEnv = process.env.BATON_SESSION_HOST_IDLE_EXIT_MS
const parsedIdleExitMs = idleExitMsEnv === undefined ? 30_000 : Number(idleExitMsEnv)
const IDLE_EXIT_MS = Number.isFinite(parsedIdleExitMs) ? parsedIdleExitMs : 30_000

export async function runSessionHost(): Promise<void> {
  const endpoint = process.env.BATON_SESSION_HOST_ENDPOINT
  if (!endpoint) {
    throw new Error('BATON_SESSION_HOST_ENDPOINT is required')
  }

  const shellRegistry = detectShells()
  const sessions = new Map<string, SessionRecord>()
  let idleTimer: NodeJS.Timeout | null = null
  let connectionCount = 0

  const server = net.createServer((socket) => {
    connectionCount += 1
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }

    let rawBuffer = ''

    socket.setEncoding('utf8')

    socket.on('data', (chunk: string | Buffer) => {
      rawBuffer += chunk.toString()
      while (true) {
        const newlineIndex = rawBuffer.indexOf('\n')
        if (newlineIndex === -1) break

        const line = rawBuffer.slice(0, newlineIndex).trim()
        rawBuffer = rawBuffer.slice(newlineIndex + 1)
        if (!line) continue

        let message: HostClientMessage
        try {
          message = JSON.parse(line) as HostClientMessage
        } catch {
          send(socket, { type: 'error', message: 'Invalid JSON message' })
          continue
        }

        if (message.type === 'create') {
          const terminalId = crypto.randomUUID()
          const cols = clampInteger(message.cols, 10, 500, 100)
          const rows = clampInteger(message.rows, 4, 200, 30)
          const cwd = resolveWorkspaceCwd(message.cwd)
          const requestedId = message.shellId && message.shellId.length > 0 ? message.shellId : 'auto'

          try {
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

            const session: SessionRecord = {
              terminalId,
              shell: resolved.descriptor.label,
              shellId: resolved.descriptor.id,
              pid: terminal.pid,
              cwd: resolved.cwd,
              pty: terminal,
              ...(startupCommandInjector ? { startupCommandInjector } : {}),
              buffer: '',
              status: 'running',
              exitCode: null,
              attachments: new Set([socket]),
            }

            terminal.onData((data) => {
              session.startupCommandInjector?.observeOutput(data)
              session.buffer = appendToRingBuffer(session.buffer, data)
              for (const attachment of session.attachments) {
                send(attachment, { type: 'data', terminalId, data })
              }
            })

            terminal.onExit(({ exitCode, signal }) => {
              session.startupCommandInjector?.dispose()
              session.startupCommandInjector = undefined
              session.pty = undefined
              session.status = 'exited'
              session.exitCode = exitCode
              session.signal = signal
              for (const attachment of session.attachments) {
                send(attachment, { type: 'exit', terminalId, exitCode, signal })
              }
            })

            sessions.set(terminalId, session)
            send(socket, {
              type: 'created',
              clientId: message.clientId,
              terminalId,
              shell: session.shell,
              shellId: session.shellId,
              pid: session.pid,
              cwd: session.cwd,
            })
          } catch (error) {
            send(socket, {
              type: 'error',
              clientId: message.clientId,
              message: error instanceof Error ? error.message : 'Unable to create terminal',
            })
          }
          continue
        }

        if (message.type === 'attach') {
          const session = sessions.get(message.terminalId)
          if (!session) {
            send(socket, {
              type: 'error',
              clientId: message.clientId,
              message: `Terminal session "${message.terminalId}" is no longer available`,
            })
            continue
          }

          session.attachments.add(socket)
          send(socket, {
            type: 'attached',
            clientId: message.clientId,
            terminalId: session.terminalId,
            shell: session.shell,
            shellId: session.shellId,
            pid: session.pid,
            cwd: session.cwd,
            status: session.status,
            exitCode: session.exitCode,
            buffer: session.buffer,
          })
          continue
        }

        if (message.type === 'write') {
          const session = sessions.get(message.terminalId)
          if (!session?.pty) continue
          if (typeof message.data !== 'string' || message.data.length > 65536) continue
          session.pty.write(message.data)
          continue
        }

        if (message.type === 'resize') {
          const session = sessions.get(message.terminalId)
          if (!session?.pty) continue
          session.pty.resize(
            clampInteger(message.cols, 10, 500, 100),
            clampInteger(message.rows, 4, 200, 30),
          )
          continue
        }

        if (message.type === 'close') {
          const session = sessions.get(message.terminalId)
          if (!session) {
            send(socket, { type: 'closed', clientId: message.clientId, ok: false })
            continue
          }

          try {
            session.startupCommandInjector?.dispose()
            session.startupCommandInjector = undefined
            session.pty?.kill()
          } catch {
            // Ignore shutdown errors.
          } finally {
            sessions.delete(message.terminalId)
            session.attachments.clear()
            send(socket, { type: 'closed', clientId: message.clientId, ok: true })
            scheduleIdleExitIfNeeded(sessions, connectionCount, idleTimer, () => {
              idleTimer = setTimeout(() => {
                void shutdown(server, endpoint)
              }, IDLE_EXIT_MS)
            })
          }
        }
      }
    })

    socket.on('close', () => {
      connectionCount = Math.max(0, connectionCount - 1)
      for (const session of sessions.values()) {
        session.attachments.delete(socket)
      }
      scheduleIdleExitIfNeeded(sessions, connectionCount, idleTimer, () => {
        idleTimer = setTimeout(() => {
          void shutdown(server, endpoint)
        }, IDLE_EXIT_MS)
      })
    })
  })

  server.on('error', (error) => {
    console.error('[baton-session-host]', error)
  })

  await listenOnEndpoint(server, endpoint)
}

function appendToRingBuffer(current: string, data: string): string {
  const next = `${current}${data}`
  return next.length > MAX_BUFFER_BYTES ? next.slice(-MAX_BUFFER_BYTES) : next
}

function send(socket: Socket, message: HostServerMessage): void {
  if (socket.destroyed || !socket.writable) return
  socket.write(`${JSON.stringify(message)}\n`)
}

function scheduleIdleExitIfNeeded(
  sessions: Map<string, SessionRecord>,
  connectionCount: number,
  idleTimer: NodeJS.Timeout | null,
  schedule: () => void,
): void {
  if (sessions.size > 0 || connectionCount > 0 || idleTimer) return
  schedule()
}

async function shutdown(server: net.Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })

  if (process.platform !== 'win32') {
    try {
      await fs.unlink(endpoint)
    } catch {
      // Ignore missing socket cleanup.
    }
  }

  process.exit(0)
}

async function listenOnEndpoint(server: net.Server, endpoint: string): Promise<void> {
  if (process.platform !== 'win32') {
    await fs.mkdir(path.dirname(endpoint), { recursive: true })
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint)
  }).catch(async (error: unknown) => {
    const err = error as NodeJS.ErrnoException
    if (process.platform !== 'win32' && err.code === 'EADDRINUSE') {
      const reachable = await canConnect(endpoint)
      if (!reachable) {
        await fs.unlink(endpoint).catch(() => undefined)
        return listenOnEndpoint(server, endpoint)
      }
    }
    throw err
  })

  if (process.platform !== 'win32') {
    await fs.chmod(endpoint, 0o600).catch(() => undefined)
  }
}

async function canConnect(endpoint: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}
