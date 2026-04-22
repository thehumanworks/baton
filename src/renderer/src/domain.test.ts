import { describe, expect, test } from 'bun:test'
import {
  createTerminalWindow,
  createWorkspace,
  nextFocusedTerminalId,
  resolveFocusedTerminalIndex,
} from './domain'

function makeTerminals(count: number) {
  return Array.from({ length: count }, (_, index) =>
    createTerminalWindow({
      x: 0,
      y: 0,
      z: index + 1,
      index: index + 1,
    }),
  )
}

describe('createWorkspace focus defaults', () => {
  test('new workspaces start with focus mode disabled and no focused terminal', () => {
    const workspace = createWorkspace('Main')
    expect(workspace.focusMode).toBe(false)
    expect(workspace.focusedTerminalId).toBeNull()
  })
})

describe('resolveFocusedTerminalIndex', () => {
  test('returns -1 for empty terminal lists', () => {
    expect(resolveFocusedTerminalIndex([], null)).toBe(-1)
    expect(resolveFocusedTerminalIndex([], 'missing')).toBe(-1)
  })

  test('falls back to the first terminal when the focused id is missing', () => {
    const terminals = makeTerminals(3)
    expect(resolveFocusedTerminalIndex(terminals, null)).toBe(0)
    expect(resolveFocusedTerminalIndex(terminals, 'not-real')).toBe(0)
  })

  test('returns the index of the focused terminal when present', () => {
    const terminals = makeTerminals(3)
    expect(resolveFocusedTerminalIndex(terminals, terminals[1]!.id)).toBe(1)
    expect(resolveFocusedTerminalIndex(terminals, terminals[2]!.id)).toBe(2)
  })
})

describe('nextFocusedTerminalId', () => {
  test('returns null when there are no terminals', () => {
    expect(nextFocusedTerminalId([], null, 1)).toBeNull()
    expect(nextFocusedTerminalId([], 'whatever', -1)).toBeNull()
  })

  test('moves forward and wraps around the end', () => {
    const terminals = makeTerminals(3)
    expect(nextFocusedTerminalId(terminals, terminals[0]!.id, 1)).toBe(terminals[1]!.id)
    expect(nextFocusedTerminalId(terminals, terminals[2]!.id, 1)).toBe(terminals[0]!.id)
  })

  test('moves backward and wraps around the start', () => {
    const terminals = makeTerminals(3)
    expect(nextFocusedTerminalId(terminals, terminals[1]!.id, -1)).toBe(terminals[0]!.id)
    expect(nextFocusedTerminalId(terminals, terminals[0]!.id, -1)).toBe(terminals[2]!.id)
  })

  test('null focus is treated as the first terminal for navigation', () => {
    const terminals = makeTerminals(3)
    expect(nextFocusedTerminalId(terminals, null, 1)).toBe(terminals[1]!.id)
    expect(nextFocusedTerminalId(terminals, null, -1)).toBe(terminals[2]!.id)
  })
})
