import { describe, expect, test } from 'bun:test'
import { createTerminalStartupGate } from './terminal-startup'

describe('terminal startup gate', () => {
  test('allows a hydrated persisted terminalId to replace a pending fresh create', () => {
    const gate = createTerminalStartupGate()

    expect(gate.begin({ status: 'starting' })).toBe('create')
    expect(gate.begin({ status: 'starting', terminalId: 'session-restored' })).toBe(
      'attach:session-restored',
    )
  })

  test('suppresses duplicate starts for the same startup target', () => {
    const gate = createTerminalStartupGate()

    expect(gate.begin({ status: 'starting', terminalId: 'session-restored' })).toBe(
      'attach:session-restored',
    )
    expect(gate.begin({ status: 'starting', terminalId: 'session-restored' })).toBeNull()
  })

  test('ignores stale completion from an attempt replaced by a hydrated session', () => {
    const gate = createTerminalStartupGate()
    const staleCreate = gate.begin({ status: 'starting' })
    const restoredAttach = gate.begin({ status: 'starting', terminalId: 'session-restored' })

    expect(staleCreate).toBe('create')
    expect(restoredAttach).toBe('attach:session-restored')

    gate.finish(staleCreate!)

    expect(gate.begin({ status: 'starting', terminalId: 'session-restored' })).toBeNull()
  })

  test('does not start sessions for settled terminal states', () => {
    const gate = createTerminalStartupGate()

    expect(gate.begin({ status: 'running', terminalId: 'session-restored' })).toBeNull()
    expect(gate.begin({ status: 'exited', terminalId: 'session-restored' })).toBeNull()
    expect(gate.begin({ status: 'error', terminalId: 'session-restored' })).toBeNull()
  })
})
