import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const HOST_START_TIMEOUT_MS = 8_000
const MESSAGE_TIMEOUT_MS = 8_000

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getSessionHostEndpoint(userDataPath) {
  const hash = crypto.createHash('sha256').update(userDataPath).digest('hex').slice(0, 16)

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\baton-session-host-${hash}`
  }

  const baseDir = process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR.length > 0
    ? process.env.XDG_RUNTIME_DIR
    : os.tmpdir()

  return path.join(baseDir, `baton-session-host-${hash}.sock`)
}

function buildCommand(shellId, marker) {
  if (shellId === 'cmd') return `echo ${marker}\r`
  if (shellId === 'pwsh' || shellId === 'powershell') return `Write-Output '${marker}'\r`
  return `printf '${marker}\\n'\r`
}

function send(socket, message) {
  socket.write(`${JSON.stringify(message)}\n`)
}

function createMessageStream(socket) {
  let rawBuffer = ''
  const queue = []
  const waiters = []

  const onMessage = (message) => {
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index]
      if (!waiter.predicate(message)) continue
      waiters.splice(index, 1)
      clearTimeout(waiter.timeout)
      waiter.resolve(message)
      return
    }
    queue.push(message)
  }

  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    rawBuffer += chunk.toString()
    while (true) {
      const newlineIndex = rawBuffer.indexOf('\n')
      if (newlineIndex === -1) break
      const line = rawBuffer.slice(0, newlineIndex).trim()
      rawBuffer = rawBuffer.slice(newlineIndex + 1)
      if (!line) continue
      onMessage(JSON.parse(line))
    }
  })

  return {
    waitFor(predicate, timeoutMs = MESSAGE_TIMEOUT_MS) {
      const queuedIndex = queue.findIndex(predicate)
      if (queuedIndex !== -1) {
        return Promise.resolve(queue.splice(queuedIndex, 1)[0])
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.resolve === resolve)
          if (waiterIndex !== -1) waiters.splice(waiterIndex, 1)
          reject(new Error('Timed out waiting for session-host message'))
        }, timeoutMs)

        waiters.push({ predicate, resolve, timeout })
      })
    },
  }
}

async function connectWithRetries(endpoint, timeoutMs = HOST_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const socket = await new Promise((resolve, reject) => {
        const connection = net.createConnection(endpoint)
        const cleanup = () => {
          connection.removeListener('connect', onConnect)
          connection.removeListener('error', onError)
        }
        const onConnect = () => {
          cleanup()
          resolve(connection)
        }
        const onError = (error) => {
          cleanup()
          connection.destroy()
          reject(error)
        }
        connection.once('connect', onConnect)
        connection.once('error', onError)
      })
      return socket
    } catch (error) {
      lastError = error
      await delay(100)
    }
  }

  throw lastError ?? new Error('Unable to connect to session host')
}

async function main() {
  const buildEntryPath = path.join(process.cwd(), 'out/main/index.js')
  await fs.access(buildEntryPath)

  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-session-verify-'))
  const endpoint = getSessionHostEndpoint(userDataPath)

  let stdout = ''
  let stderr = ''
  const child = spawn(process.execPath, ['x', 'electron', buildEntryPath, '--baton-session-host'], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      BATON_SESSION_HOST_ENDPOINT: endpoint,
      BATON_SESSION_HOST_IDLE_EXIT_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  let firstSocket
  let secondSocket

  try {
    firstSocket = await connectWithRetries(endpoint)
    const firstStream = createMessageStream(firstSocket)

    send(firstSocket, {
      type: 'create',
      clientId: 'create-1',
      cols: 80,
      rows: 24,
      cwd: userDataPath,
      ...(process.platform === 'win32' ? { shellId: 'powershell' } : { shellId: 'sh' }),
    })

    const created = await firstStream.waitFor((message) => message.type === 'created' && message.clientId === 'create-1')
    if (!created.pid || typeof created.pid !== 'number') {
      throw new Error(`Expected create response to include a numeric pid: ${JSON.stringify(created)}`)
    }

    const firstMarker = 'BATON_BEFORE_DETACH'
    send(firstSocket, {
      type: 'write',
      terminalId: created.terminalId,
      data: buildCommand(created.shellId, firstMarker),
    })

    const firstData = await firstStream.waitFor(
      (message) => message.type === 'data' && message.terminalId === created.terminalId && String(message.data).includes(firstMarker),
    )
    if (!String(firstData.data).includes(firstMarker)) {
      throw new Error('Did not receive the expected marker before detach')
    }

    await new Promise((resolve) => firstSocket.end(resolve))

    secondSocket = await connectWithRetries(endpoint)
    const secondStream = createMessageStream(secondSocket)

    send(secondSocket, {
      type: 'attach',
      clientId: 'attach-1',
      terminalId: created.terminalId,
    })

    const attached = await secondStream.waitFor((message) => message.type === 'attached' && message.clientId === 'attach-1')
    if (attached.pid !== created.pid) {
      throw new Error(`Expected attach pid ${attached.pid} to match create pid ${created.pid}`)
    }
    if (attached.status !== 'running') {
      throw new Error(`Expected attached session to be running: ${JSON.stringify(attached)}`)
    }
    if (!String(attached.buffer).includes(firstMarker)) {
      throw new Error('Expected attached buffer to replay output from before detach')
    }

    const secondMarker = 'BATON_AFTER_ATTACH'
    send(secondSocket, {
      type: 'write',
      terminalId: created.terminalId,
      data: buildCommand(created.shellId, secondMarker),
    })

    const secondData = await secondStream.waitFor(
      (message) => message.type === 'data' && message.terminalId === created.terminalId && String(message.data).includes(secondMarker),
    )
    if (!String(secondData.data).includes(secondMarker)) {
      throw new Error('Did not receive the expected marker after reattach')
    }

    send(secondSocket, {
      type: 'close',
      clientId: 'close-1',
      terminalId: created.terminalId,
    })

    const closed = await secondStream.waitFor((message) => message.type === 'closed' && message.clientId === 'close-1')
    if (!closed.ok) {
      throw new Error(`Expected terminal close to succeed: ${JSON.stringify(closed)}`)
    }

    await new Promise((resolve) => secondSocket.end(resolve))
    await new Promise((resolve) => child.once('exit', resolve))

    console.log('Session persistence verification passed')
    console.log(`- terminal pid survived detach/reattach: ${created.pid}`)
    console.log(`- replay buffer contained: ${firstMarker}`)
    console.log(`- live output after reattach contained: ${secondMarker}`)
  } catch (error) {
    if (firstSocket && !firstSocket.destroyed) firstSocket.destroy()
    if (secondSocket && !secondSocket.destroyed) secondSocket.destroy()
    child.kill('SIGTERM')
    throw new Error([
      error instanceof Error ? error.message : String(error),
      stdout ? `\n[session-host stdout]\n${stdout}` : '',
      stderr ? `\n[session-host stderr]\n${stderr}` : '',
    ].join(''))
  } finally {
    try {
      await fs.rm(userDataPath, { recursive: true, force: true })
    } catch {
      // Ignore temp cleanup failures.
    }
  }
}

await main()
