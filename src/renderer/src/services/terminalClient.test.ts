import { describe, expect, test } from 'bun:test'
import { BufferedTerminalClient, type TerminalClient } from './terminalClient'
import type {
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

  test('listShells delegates to the inner client', async () => {
    const inner = makeStubClient()
    const buffered = new BufferedTerminalClient(inner)

    const result = await buffered.listShells()

    expect(inner.calls.listShellsCount).toBe(1)
    expect(result.defaultShellId).toBe('pwsh')
    expect(result.shells[0]!.id).toBe('pwsh')
  })
})
