import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const invoke = mock(() => Promise.resolve(undefined))
const send = mock(() => undefined)
const on = mock(() => undefined)
const removeListener = mock(() => undefined)
const exposeInMainWorld = mock(() => undefined)

mock.module('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, send, on, removeListener },
}))

let baton: Window['baton']

beforeEach(() => {
  invoke.mockClear()
  send.mockClear()
  on.mockClear()
  removeListener.mockClear()
  exposeInMainWorld.mockClear()
  delete require.cache[require.resolve('./index')]
  require('./index')
  baton = exposeInMainWorld.mock.calls[0]?.[1] as Window['baton']
})

afterEach(() => {
  delete (globalThis as { baton?: unknown }).baton
})

describe('preload agentSession bridge', () => {
  test('exposes typed agentSession invoke/send APIs', async () => {
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
    const [key, api] = exposeInMainWorld.mock.calls[0]!
    expect(key).toBe('baton')
    baton = api as Window['baton']

    await baton?.agentSession.create({ cols: 80, rows: 24, cwd: '/tmp' })
    expect(invoke).toHaveBeenCalledWith('agentSession:create', { cols: 80, rows: 24, cwd: '/tmp' })

    await baton?.agentSession.list()
    expect(invoke).toHaveBeenCalledWith('agentSession:list')

    await baton?.agentSession.get('session-1')
    expect(invoke).toHaveBeenCalledWith('agentSession:get', { sessionId: 'session-1' })

    baton?.agentSession.write('session-1', 'ls\n')
    expect(send).toHaveBeenCalledWith('agentSession:write', { sessionId: 'session-1', data: 'ls\n' })

    baton?.agentSession.resize('session-1', 120, 40)
    expect(send).toHaveBeenCalledWith('agentSession:resize', { sessionId: 'session-1', cols: 120, rows: 40 })

    await baton?.agentSession.close('session-1')
    expect(invoke).toHaveBeenCalledWith('agentSession:close', { sessionId: 'session-1' })
  })

  test('registers and unregisters agentSession event listeners', () => {
    const onCallsBefore = on.mock.calls.length
    const onData = mock(() => undefined)
    const disposeData = baton?.agentSession.onData(onData)
    expect(on.mock.calls.length).toBe(onCallsBefore + 1)
    const dataCall = on.mock.calls[onCallsBefore]
    expect(dataCall?.[0]).toBe('agentSession:data')
    const dataListener = dataCall?.[1] as ((event: unknown, payload: unknown) => void)
    dataListener({}, { sessionId: 'session-1', data: 'hello' })
    expect(onData).toHaveBeenCalledWith({ sessionId: 'session-1', data: 'hello' })
    disposeData?.()
    expect(removeListener).toHaveBeenCalledWith('agentSession:data', dataListener)

    const onExit = mock(() => undefined)
    const disposeExit = baton?.agentSession.onExit(onExit)
    expect(on.mock.calls.length).toBe(onCallsBefore + 2)
    const exitCall = on.mock.calls[onCallsBefore + 1]
    expect(exitCall?.[0]).toBe('agentSession:exit')
    const exitListener = exitCall?.[1] as ((event: unknown, payload: unknown) => void)
    exitListener({}, { sessionId: 'session-1', exitCode: 0, signal: null })
    expect(onExit).toHaveBeenCalledWith({ sessionId: 'session-1', exitCode: 0, signal: null })
    disposeExit?.()
    expect(removeListener).toHaveBeenCalledWith('agentSession:exit', exitListener)
  })
})
