import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPreferencesStore, migratePreferences } from './preferences'
import { DEFAULT_PREFERENCES, type AppPreferences } from '../shared/preferences-types'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'baton-prefs-'))
})

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true })
})

function storePath(): string {
  return path.join(tmpDir, 'preferences.json')
}

describe('createPreferencesStore', () => {
  test('load returns DEFAULT_PREFERENCES when the file is missing', async () => {
    const store = createPreferencesStore(storePath())
    const prefs = await store.load()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
  })

  test('load does not eagerly write the defaults to disk', async () => {
    const store = createPreferencesStore(storePath())
    await store.load()
    expect(fs.existsSync(storePath())).toBe(false)
  })

  test('save then load round-trips the preferences', async () => {
    const store = createPreferencesStore(storePath())
    const next: AppPreferences = {
      version: 1,
      terminal: { defaultShellId: 'pwsh' },
    }

    await store.save(next)
    const loaded = await store.load()
    expect(loaded).toEqual(next)
  })

  test('save uses a tmp-then-rename pattern (no dangling tmp files when successful)', async () => {
    const store = createPreferencesStore(storePath())
    await store.save({ version: 1, terminal: { defaultShellId: 'powershell' } })

    const entries = await fsp.readdir(tmpDir)
    expect(entries).toContain('preferences.json')
    expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  test('save creates the parent directory if it does not exist', async () => {
    const nested = path.join(tmpDir, 'nested', 'deeper', 'preferences.json')
    const store = createPreferencesStore(nested)

    await store.save({ version: 1, terminal: { defaultShellId: 'auto' } })
    expect(fs.existsSync(nested)).toBe(true)
  })

  test('load recovers from corrupted JSON by returning the defaults', async () => {
    await fsp.writeFile(storePath(), 'not valid json {{{', 'utf8')
    const store = createPreferencesStore(storePath())
    const prefs = await store.load()
    expect(prefs).toEqual(DEFAULT_PREFERENCES)
  })

  test('exists reflects whether the file has been written', async () => {
    const store = createPreferencesStore(storePath())
    expect(await store.exists()).toBe(false)

    await store.save({ version: 1, terminal: { defaultShellId: 'bash' } })
    expect(await store.exists()).toBe(true)
  })
})

describe('migratePreferences', () => {
  test('coerces partial input to the current shape', () => {
    const migrated = migratePreferences({})
    expect(migrated).toEqual(DEFAULT_PREFERENCES)
  })

  test('preserves known terminal.defaultShellId values', () => {
    const migrated = migratePreferences({
      version: 1,
      terminal: { defaultShellId: 'pwsh' },
    })
    expect(migrated.terminal.defaultShellId).toBe('pwsh')
  })

  test('carries wslDistro through when present', () => {
    const migrated = migratePreferences({
      version: 1,
      terminal: { defaultShellId: 'wsl:Ubuntu', defaultWslDistro: 'Ubuntu' },
    })
    expect(migrated.terminal.defaultShellId).toBe('wsl:Ubuntu')
    expect(migrated.terminal.defaultWslDistro).toBe('Ubuntu')
  })

  test('discards unknown top-level fields', () => {
    const migrated = migratePreferences({
      version: 1,
      terminal: { defaultShellId: 'zsh' },
      rogueField: 'gone',
    })
    expect((migrated as Record<string, unknown>).rogueField).toBeUndefined()
  })

  test('ignores a non-string defaultShellId', () => {
    const migrated = migratePreferences({
      version: 1,
      terminal: { defaultShellId: 42 },
    })
    expect(migrated.terminal.defaultShellId).toBe('auto')
  })

  test('future versions are downgraded to the current defaults', () => {
    const migrated = migratePreferences({
      version: 999,
      terminal: { defaultShellId: 'zsh' },
    })
    expect(migrated.version).toBe(1)
  })
})
