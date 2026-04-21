import { describe, expect, test } from 'bun:test'
import { AgentSessionManager, type PtyLike } from './agent-session-manager'
import type { ShellDescriptor } from '../shared/shell-registry'

const registry: ShellDescriptor[] = [
  { id: 'bash', kind: 'native', label: 'bash', file: '/bin/bash', args: [], platforms: ['darwin', 'linux'] },
]

function createMockPty() {
  let onData: ((data: string) => void) | undefined
  let onExit: ((event: { exitCode: number | null; signal?: number | null }) => void) | undefined
  const writes: string[] = []
  const resizes: Array<{ cols: number; rows: number }> = []
  let killed = 0

  const pty: PtyLike = {
    pid: 1234,
    write(data: string) {
      writes.push(data)
    },
    resize(cols: number, rows: number) {
      resizes.push({ cols, rows })
    },
    kill() {
      killed += 1
    },
    onData(listener) {
      onData = listener
    },
    onExit(listener) {
      onExit = listener
    },
  }

  return {
    pty,
    writes,
    resizes,
    get killed() {
      return killed
    },
    emitData(data: string) {
      onData?.(data)
    },
    emitExit(event: { exitCode: number | null; signal?: number | null }) {
      onExit?.(event)
    },
  }
}

describe('AgentSessionManager', () => {
  test('creates sessions, tracks metadata, and emits bounded recent output', async () => {
    const created = createMockPty()
    const dataEvents: Array<{ sessionId: string; data: string }> = []
    const exitEvents: Array<{ sessionId: string; exitCode: number | null; signal?: number | null }> = []

    const manager = new AgentSessionManager({
      spawn: (_file, _args, options) => {
        expect(options.cols).toBe(100)
        expect(options.rows).toBe(30)
        expect(options.cwd).toBe('/workspace')
        return created.pty
      },
      resolveEffectiveShellId: async () => 'bash',
      resolveWorkspaceCwd: () => '/workspace',
      shellRegistry: registry,
      platform: 'linux',
      env: { HOME: '/home/test' },
      now: () => 111,
      createId: () => 'session-1',
      recentOutputLimit: 5,
      onData: (event) => dataEvents.push(event),
      onExit: (event) => exitEvents.push(event),
    })

    const createdSession = await manager.create({ cols: Number.NaN, rows: Number.NaN, cwd: '/ignored' })
    expect(createdSession).toMatchObject({
      sessionId: 'session-1',
      shellId: 'bash',
      shell: 'bash',
      pid: 1234,
      cwd: '/workspace',
      status: 'running',
      createdAt: 111,
      startedAt: 111,
      recentOutput: '',
    })

    created.emitData('abc')
    created.emitData('def')
    expect(dataEvents).toEqual([
      { sessionId: 'session-1', data: 'abc' },
      { sessionId: 'session-1', data: 'def' },
    ])
    expect(manager.getById('session-1')).toMatchObject({ recentOutput: 'bcdef', status: 'running' })

    created.emitExit({ exitCode: 0, signal: null })
    expect(exitEvents).toEqual([{ sessionId: 'session-1', exitCode: 0, signal: null }])
    expect(manager.get({ sessionId: 'session-1' })).toMatchObject({
      status: 'exited',
      exitCode: 0,
      signal: null,
      closedAt: 111,
    })
    expect(manager.write('session-1', 'echo nope')).toBe(false)
  })

  test('writes, resizes, closes, and lists active sessions', async () => {
    const first = createMockPty()
    const second = createMockPty()
    const spawned = [first, second]
    let nextId = 0

    const manager = new AgentSessionManager({
      spawn: () => spawned[nextId++]!.pty,
      resolveEffectiveShellId: async () => 'bash',
      resolveWorkspaceCwd: (cwd) => cwd ?? '/workspace',
      shellRegistry: registry,
      platform: 'linux',
      env: { HOME: '/home/test' },
      createId: () => `session-${nextId + 1}`,
    })

    await manager.create({ cols: 80, rows: 24, cwd: '/one' })
    await manager.create({ cols: 81, rows: 25, cwd: '/two' })

    expect(manager.list().map((session) => session.sessionId)).toEqual(['session-1', 'session-2'])
    expect(manager.write('session-1', 'pwd\n')).toBe(true)
    expect(first.writes).toEqual(['pwd\n'])

    expect(manager.resize('session-1', 1, 999)).toBe(true)
    expect(first.resizes).toEqual([{ cols: 10, rows: 200 }])

    expect(manager.close('session-1')).toBe(true)
    expect(first.killed).toBe(1)
    expect(manager.getById('session-1')).toBeNull()

    manager.closeAll()
    expect(second.killed).toBe(1)
    expect(manager.list()).toEqual([])
  })
})
