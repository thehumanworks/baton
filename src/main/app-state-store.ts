import fs from 'node:fs/promises'
import path from 'node:path'

export interface AppStateStore {
  load(): Promise<unknown | null>
  save(next: unknown): Promise<void>
  exists(): Promise<boolean>
}

export function createAppStateStore(filePath: string): AppStateStore {
  let cacheLoaded = false
  let cache: unknown | null = null
  let writeSequence = Promise.resolve()
  let writeCount = 0

  async function load(): Promise<unknown | null> {
    if (cacheLoaded) return cache

    try {
      const raw = await fs.readFile(filePath, 'utf8')
      cache = JSON.parse(raw) as unknown
    } catch {
      cache = null
    }

    cacheLoaded = true
    return cache
  }

  async function save(next: unknown): Promise<void> {
    cache = next
    cacheLoaded = true

    const currentWrite = ++writeCount
    writeSequence = writeSequence
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        const tmp = `${filePath}.${process.pid}.${currentWrite}.tmp`
        await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
        await fs.rename(tmp, filePath)
      })

    await writeSequence
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
