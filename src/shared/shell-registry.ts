export type ShellKind = 'native' | 'wsl'

export interface ShellDescriptor {
  id: string
  kind: ShellKind
  label: string
  file: string
  args: string[]
  platforms: NodeJS.Platform[]
  meta?: {
    wslDistro?: string
  }
}

export interface UnixRegistryInput {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  fileExists: (path: string) => boolean
}

export interface WindowsRegistryInput {
  hasExecutable: (name: string) => boolean
  wslDistros: string[]
  env: Record<string, string | undefined>
}

const UNIX_CANDIDATES: Array<{ id: string; file: string; label: string }> = [
  { id: 'zsh', file: '/bin/zsh', label: 'zsh' },
  { id: 'bash', file: '/bin/bash', label: 'bash' },
  { id: 'fish', file: '/usr/bin/fish', label: 'fish' },
  { id: 'fish-brew', file: '/opt/homebrew/bin/fish', label: 'fish (Homebrew)' },
  { id: 'sh', file: '/bin/sh', label: 'sh' },
]

export function buildUnixRegistry(input: UnixRegistryInput): ShellDescriptor[] {
  const out: ShellDescriptor[] = []
  const seenFiles = new Set<string>()

  const loginShell = input.env.SHELL
  if (loginShell && input.fileExists(loginShell)) {
    out.push({
      id: idForUnixFile(loginShell),
      kind: 'native',
      label: labelForUnixFile(loginShell),
      file: loginShell,
      args: [],
      platforms: [input.platform],
    })
    seenFiles.add(loginShell)
  }

  for (const candidate of UNIX_CANDIDATES) {
    if (seenFiles.has(candidate.file)) continue
    if (!input.fileExists(candidate.file)) continue
    out.push({
      id: candidate.id,
      kind: 'native',
      label: candidate.label,
      file: candidate.file,
      args: [],
      platforms: [input.platform],
    })
    seenFiles.add(candidate.file)
  }

  if (out.length === 0) {
    const fallbackFile = input.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
    out.push({
      id: idForUnixFile(fallbackFile),
      kind: 'native',
      label: labelForUnixFile(fallbackFile),
      file: fallbackFile,
      args: [],
      platforms: [input.platform],
    })
  }

  return out
}

function idForUnixFile(file: string): string {
  const base = basename(file)
  return base || 'sh'
}

function labelForUnixFile(file: string): string {
  return basename(file) || file
}

function basename(file: string): string {
  const idx = file.lastIndexOf('/')
  return idx === -1 ? file : file.slice(idx + 1)
}

export function buildWindowsRegistry(input: WindowsRegistryInput): ShellDescriptor[] {
  const out: ShellDescriptor[] = []

  if (input.hasExecutable('powershell.exe')) {
    out.push({
      id: 'powershell',
      kind: 'native',
      label: 'Windows PowerShell',
      file: 'powershell.exe',
      args: ['-NoLogo'],
      platforms: ['win32'],
    })
  }

  if (input.hasExecutable('pwsh.exe')) {
    out.push({
      id: 'pwsh',
      kind: 'native',
      label: 'PowerShell 7',
      file: 'pwsh.exe',
      args: ['-NoLogo'],
      platforms: ['win32'],
    })
  }

  if (input.hasExecutable('cmd.exe')) {
    out.push({
      id: 'cmd',
      kind: 'native',
      label: 'Command Prompt',
      file: input.env.ComSpec || 'cmd.exe',
      args: [],
      platforms: ['win32'],
    })
  }

  for (const distro of input.wslDistros) {
    out.push({
      id: `wsl:${distro}`,
      kind: 'wsl',
      label: `WSL · ${distro}`,
      file: 'wsl.exe',
      args: ['-d', distro],
      platforms: ['win32'],
      meta: { wslDistro: distro },
    })
  }

  return out
}

export function findShell(
  registry: readonly ShellDescriptor[],
  id: string,
): ShellDescriptor | undefined {
  if (id === 'auto') return undefined
  return registry.find((d) => d.id === id)
}

export function isWslId(id: string): boolean {
  return id.startsWith('wsl:') && id.length > 4
}

export function parseWslDistro(id: string): string | undefined {
  if (!isWslId(id)) return undefined
  return id.slice(4)
}
