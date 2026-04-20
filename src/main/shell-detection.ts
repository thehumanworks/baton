import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  buildUnixRegistry,
  buildWindowsRegistry,
  type ShellDescriptor,
} from '../shared/shell-registry'

export function detectShells(): ShellDescriptor[] {
  if (process.platform === 'win32') {
    return buildWindowsRegistry({
      hasExecutable: hasExecutableOnPath,
      wslDistros: detectWslDistros(),
      env: process.env,
    })
  }

  return buildUnixRegistry({
    platform: process.platform,
    env: process.env,
    fileExists: (p) => {
      try {
        return fs.statSync(p).isFile()
      } catch {
        return false
      }
    },
  })
}

function hasExecutableOnPath(name: string): boolean {
  const envPath = process.env.PATH
  if (!envPath) return false
  const separator = process.platform === 'win32' ? ';' : ':'
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT?.split(';') ?? ['.EXE'])
    : ['']
  for (const dir of envPath.split(separator)) {
    if (!dir) continue
    for (const ext of extensions) {
      const nameWithExt = ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? name + ext : name
      const candidate = path.join(dir, nameWithExt)
      try {
        if (fs.statSync(candidate).isFile()) return true
      } catch {
        // ignore
      }
    }
  }
  return false
}

function detectWslDistros(): string[] {
  if (process.platform !== 'win32') return []
  try {
    const result = spawnSync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le', timeout: 2000 })
    if (result.status !== 0 || typeof result.stdout !== 'string') return []
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}
