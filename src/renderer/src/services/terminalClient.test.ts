import { describe, expect, test } from 'bun:test'
import { BufferedTerminalClient, resolveTerminalWebSocketUrl, type TerminalClient } from './terminalClient'
import type {
  TerminalAttachResponse,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalListShellsResponse,
} from '@shared/terminal-types'

type Listener<T> = (event: T) => void

function makeStubClient(): TerminalClient & {
  calls: {
    createTerminal: TerminalCreateRequest[]
    listShellsCount: number
  }
} {
  const dataListeners = new Set<Listener<TerminalDataEvent>>()
  const exitListeners = new Set<Listener<TerminalExitEvent>>()

  const calls = { createTerminal: [] as TerminalCreateRequest[], listShellsCount: 0 }

  return {
    mode: 'electron' as const,
    calls,
    async createTerminal(request: TerminalCreateRequest): Promise<TerminalCreateResponse> {
      calls.createTerminal.push(request)
      return {
        terminalId: 'pty-1',
        shell: 'pwsh',
        shellId: request.shellId ?? 'auto',
        cwd: '/tmp',
      }
    },
    async attachTerminal(terminalId: string): Promise<TerminalAttachResponse> {
      return {
        terminalId,
        shell: 'pwsh',
        shellId: 'pwsh',
        cwd: '/tmp',
        status: 'running',
        exitCode: null,
        buffer: 'hello from host',
      }
    },
    write() {},
    resize() {},
    async close() {
      return true
    },
    onData(listener) {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
    onExit(listener) {
      exitListeners.add(listener)
      return () => exitListeners.delete(listener)
    },
    async listShells(): Promise<TerminalListShellsResponse> {
      calls.listShellsCount += 1
      return {
        shells: [{ id: 'pwsh', label: 'PowerShell 7', kind: 'native' }],
        defaultShellId: 'pwsh',
      }
    },
  }
}

describe('BufferedTerminalClient', () => {
  test('forwards shellId and wslDistro on createTerminal', async () => {
    const inner = makeStubClient()
    const buffered = new BufferedTerminalClient(inner)

    await buffered.createTerminal({ cols: 100, rows: 30, shellId: 'wsl:Ubuntu', wslDistro: 'Ubuntu' })

    expect(inner.calls.createTerminal).toHaveLength(1)
    expect(inner.calls.createTerminal[0]!.shellId).toBe('wsl:Ubuntu')
    expect(inner.calls.createTerminal[0]!.wslDistro).toBe('Ubuntu')
  })

  test('attachTerminal seeds the replay buffer from the host response', async () => {
    const inner = makeStubClient()
    const buffered = new BufferedTerminalClient(inner)

    const response = await buffered.attachTerminal('pty-existing')

    expect(response.status).toBe('running')
    expect(buffered.getBuffer('pty-existing')).toBe('hello from host')
  })

  test('listShells delegates to the inner client', async () => {
    const inner = makeStubClient()
    const buffered = new BufferedTerminalClient(inner)

    const result = await buffered.listShells()

    expect(inner.calls.listShellsCount).toBe(1)
    expect(result.defaultShellId).toBe('pwsh')
    expect(result.shells[0]!.id).toBe('pwsh')
  })
})

describe('resolveTerminalWebSocketUrl', () => {
  const phonePageLocation = {
    protocol: 'http:',
    hostname: '192.168.1.20',
  }

  test('derives the terminal server URL from the browser page host for LAN clients', () => {
    expect(resolveTerminalWebSocketUrl('auto', phonePageLocation)).toBe('ws://192.168.1.20:8787')
  })

  test('replaces wildcard bind addresses with the browser page host', () => {
    expect(resolveTerminalWebSocketUrl('ws://0.0.0.0:8787', phonePageLocation)).toBe('ws://192.168.1.20:8787/')
  })
})
