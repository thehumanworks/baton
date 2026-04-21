import type { TerminalStatus } from '../domain'

export type TerminalStartupKey = 'create' | `attach:${string}`

interface TerminalStartupTarget {
  status: TerminalStatus
  terminalId?: string
}

export interface TerminalStartupGate {
  begin(target: TerminalStartupTarget): TerminalStartupKey | null
  finish(key: TerminalStartupKey): void
}

function getStartupKey(target: TerminalStartupTarget): TerminalStartupKey | null {
  if (target.status !== 'starting') return null
  return target.terminalId ? `attach:${target.terminalId}` : 'create'
}

export function createTerminalStartupGate(): TerminalStartupGate {
  let activeKey: TerminalStartupKey | null = null

  return {
    begin(target) {
      const nextKey = getStartupKey(target)
      if (!nextKey || nextKey === activeKey) return null

      activeKey = nextKey
      return nextKey
    },
    finish(key) {
      if (activeKey === key) activeKey = null
    },
  }
}
