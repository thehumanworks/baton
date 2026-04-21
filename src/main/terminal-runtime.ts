import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function expandHomePrefix(input: string, home: string): string {
  if (input === '~') return home
  if (input.startsWith('~/')) return path.join(home, input.slice(2))
  if (process.platform === 'win32' && input.startsWith('~\\')) {
    return path.join(home, input.slice(2))
  }
  return input
}

function expandEnvVars(input: string): string {
  if (process.platform === 'win32') {
    return input.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? '')
  }
  return input.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced?: string, bare?: string) => {
    const name = braced ?? bare
    if (!name) return ''
    return process.env[name] ?? ''
  })
}

export function resolveWorkspaceCwd(requested?: string): string {
  const home = os.homedir()
  if (!requested) return home

  const trimmed = requested.trim()
  if (!trimmed) return home

  const expanded = path.normalize(expandEnvVars(expandHomePrefix(trimmed, home)))
  if (!path.isAbsolute(expanded)) return home

  try {
    const stat = fs.statSync(expanded)
    if (!stat.isDirectory()) return home
  } catch {
    return home
  }

  return expanded
}
