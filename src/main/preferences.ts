import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CURRENT_PREFERENCES_VERSION,
  DEFAULT_PREFERENCES,
  type AppPreferences,
} from '../shared/preferences-types'

export interface PreferencesStore {
  load(): Promise<AppPreferences>
  save(next: AppPreferences): Promise<void>
  exists(): Promise<boolean>
}

export function createPreferencesStore(filePath: string): PreferencesStore {
  let cache: AppPreferences | null = null

  async function load(): Promise<AppPreferences> {
    if (cache) return cache
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      cache = migratePreferences(parsed)
    } catch {
      cache = DEFAULT_PREFERENCES
    }
    return cache
  }

  async function save(next: AppPreferences): Promise<void> {
    const migrated = migratePreferences(next)
    cache = migrated

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(migrated, null, 2), 'utf8')
    await fs.rename(tmp, filePath)
  }

  async function exists(): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  return { load, save, exists }
}

export function migratePreferences(raw: unknown): AppPreferences {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_PREFERENCES
  }

  const source = raw as Record<string, unknown>
  const terminalSource =
    source.terminal && typeof source.terminal === 'object'
      ? (source.terminal as Record<string, unknown>)
      : {}

  const defaultShellId =
    typeof terminalSource.defaultShellId === 'string' && terminalSource.defaultShellId.length > 0
      ? terminalSource.defaultShellId
      : DEFAULT_PREFERENCES.terminal.defaultShellId

  const defaultWslDistro =
    typeof terminalSource.defaultWslDistro === 'string' && terminalSource.defaultWslDistro.length > 0
      ? terminalSource.defaultWslDistro
      : undefined

  return {
    version: CURRENT_PREFERENCES_VERSION,
    terminal: {
      defaultShellId,
      ...(defaultWslDistro ? { defaultWslDistro } : {}),
    },
  }
}
