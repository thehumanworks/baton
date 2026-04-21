import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAppStateStore } from './app-state-store'

describe('createAppStateStore', () => {
  let tempDir: string
  let filePath: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-app-state-'))
    filePath = path.join(tempDir, 'app-state.json')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test('load returns null when the file is missing', async () => {
    const store = createAppStateStore(filePath)

    await expect(store.load()).resolves.toBeNull()
  })

  test('save then load round-trips arbitrary JSON data', async () => {
    const store = createAppStateStore(filePath)
    const state = {
      workspaces: [{ id: 'ws-1', name: 'Main' }],
      activeWorkspaceId: 'ws-1',
      sidebarCollapsed: true,
      themePreference: 'dark',
    }

    await store.save(state)

    await expect(store.load()).resolves.toEqual(state)
  })

  test('save creates the parent directory if needed', async () => {
    const nestedPath = path.join(tempDir, 'nested', 'state', 'app-state.json')
    const store = createAppStateStore(nestedPath)

    await store.save({ hello: 'world' })

    await expect(fs.readFile(nestedPath, 'utf8')).resolves.toContain('world')
  })

  test('load recovers from invalid JSON by returning null', async () => {
    await fs.writeFile(filePath, '{not-json', 'utf8')
    const store = createAppStateStore(filePath)

    await expect(store.load()).resolves.toBeNull()
  })

  test('exists reflects whether the file has been written', async () => {
    const store = createAppStateStore(filePath)

    await expect(store.exists()).resolves.toBe(false)
    await store.save({ ok: true })
    await expect(store.exists()).resolves.toBe(true)
  })

  test('concurrent saves serialize and leave the latest value on disk', async () => {
    const store = createAppStateStore(filePath)

    await Promise.all([
      store.save({ seq: 1 }),
      store.save({ seq: 2 }),
      store.save({ seq: 3 }),
    ])

    await expect(store.load()).resolves.toEqual({ seq: 3 })
    await expect(fs.readFile(filePath, 'utf8')).resolves.toContain('3')
  })
})
