import { describe, expect, test } from 'bun:test'
import {
  buildUnixRegistry,
  buildWindowsRegistry,
  findShell,
  isWslId,
  parseWslDistro,
  type ShellDescriptor,
} from './shell-registry'

describe('buildUnixRegistry', () => {
  test('returns a single "auto" descriptor when $SHELL is set to a known shell', () => {
    const registry = buildUnixRegistry({
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
      fileExists: () => true,
    })

    const ids = registry.map((d: ShellDescriptor) => d.id)
    expect(ids).toContain('zsh')
    expect(registry.every((d: ShellDescriptor) => d.kind === 'native')).toBe(true)
  })

  test('falls back to /bin/zsh on darwin when $SHELL is missing', () => {
    const registry = buildUnixRegistry({
      platform: 'darwin',
      env: {},
      fileExists: (p: string) => p === '/bin/zsh',
    })

    expect(registry.map((d: ShellDescriptor) => d.id)).toContain('zsh')
  })

  test('falls back to /bin/bash on linux when $SHELL is missing', () => {
    const registry = buildUnixRegistry({
      platform: 'linux',
      env: {},
      fileExists: (p: string) => p === '/bin/bash',
    })

    expect(registry.map((d: ShellDescriptor) => d.id)).toContain('bash')
  })

  test('includes additional detected shells beyond $SHELL', () => {
    const registry = buildUnixRegistry({
      platform: 'linux',
      env: { SHELL: '/bin/bash' },
      fileExists: (p: string) => p === '/bin/bash' || p === '/usr/bin/fish',
    })

    const ids = registry.map((d: ShellDescriptor) => d.id)
    expect(ids).toContain('bash')
    expect(ids).toContain('fish')
  })

  test('descriptors carry no windows-specific metadata', () => {
    const registry = buildUnixRegistry({
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
      fileExists: () => true,
    })
    for (const d of registry) {
      expect(d.kind).toBe('native')
      expect(d.meta?.wslDistro).toBeUndefined()
    }
  })
})

describe('buildWindowsRegistry', () => {
  test('includes powershell, pwsh, and cmd when all are present', () => {
    const registry = buildWindowsRegistry({
      hasExecutable: (name: string) =>
        ['powershell.exe', 'pwsh.exe', 'cmd.exe'].includes(name),
      wslDistros: [],
      env: {},
    })

    const ids = registry.map((d: ShellDescriptor) => d.id)
    expect(ids).toContain('powershell')
    expect(ids).toContain('pwsh')
    expect(ids).toContain('cmd')
  })

  test('omits pwsh when pwsh.exe is not on PATH', () => {
    const registry = buildWindowsRegistry({
      hasExecutable: (name: string) => name !== 'pwsh.exe',
      wslDistros: [],
      env: {},
    })

    expect(registry.map((d: ShellDescriptor) => d.id)).not.toContain('pwsh')
  })

  test('adds a wsl:<distro> descriptor per detected distribution', () => {
    const registry = buildWindowsRegistry({
      hasExecutable: (name: string) => name === 'wsl.exe' || name === 'powershell.exe',
      wslDistros: ['Ubuntu', 'Debian'],
      env: {},
    })

    const ids = registry.map((d: ShellDescriptor) => d.id)
    expect(ids).toContain('wsl:Ubuntu')
    expect(ids).toContain('wsl:Debian')

    const ubuntu = registry.find((d: ShellDescriptor) => d.id === 'wsl:Ubuntu') as ShellDescriptor
    expect(ubuntu.kind).toBe('wsl')
    expect(ubuntu.meta?.wslDistro).toBe('Ubuntu')
    expect(ubuntu.file).toBe('wsl.exe')
    expect(ubuntu.args).toEqual(['-d', 'Ubuntu'])
  })

  test('uses ComSpec for the cmd descriptor when set', () => {
    const registry = buildWindowsRegistry({
      hasExecutable: () => true,
      wslDistros: [],
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    })

    const cmd = registry.find((d: ShellDescriptor) => d.id === 'cmd') as ShellDescriptor
    expect(cmd.file).toBe('C:\\Windows\\System32\\cmd.exe')
  })

  test('descriptor labels are human readable', () => {
    const registry = buildWindowsRegistry({
      hasExecutable: () => true,
      wslDistros: ['Ubuntu-22.04'],
      env: {},
    })

    const ubuntu = registry.find((d: ShellDescriptor) => d.id === 'wsl:Ubuntu-22.04')!
    expect(ubuntu.label).toContain('Ubuntu-22.04')
    expect(ubuntu.label.toLowerCase()).toContain('wsl')

    const ps = registry.find((d: ShellDescriptor) => d.id === 'powershell')!
    expect(ps.label.toLowerCase()).toContain('powershell')
  })
})

describe('findShell', () => {
  const registry: ShellDescriptor[] = [
    {
      id: 'powershell',
      kind: 'native',
      label: 'Windows PowerShell',
      file: 'powershell.exe',
      args: ['-NoLogo'],
      platforms: ['win32'],
    },
    {
      id: 'wsl:Ubuntu',
      kind: 'wsl',
      label: 'WSL · Ubuntu',
      file: 'wsl.exe',
      args: ['-d', 'Ubuntu'],
      platforms: ['win32'],
      meta: { wslDistro: 'Ubuntu' },
    },
  ]

  test('returns the descriptor for a known id', () => {
    expect(findShell(registry, 'powershell')?.id).toBe('powershell')
    expect(findShell(registry, 'wsl:Ubuntu')?.id).toBe('wsl:Ubuntu')
  })

  test('returns undefined for an unknown id', () => {
    expect(findShell(registry, 'nushell')).toBeUndefined()
    expect(findShell(registry, 'wsl:DoesNotExist')).toBeUndefined()
  })

  test('returns undefined for the "auto" sentinel (caller must resolve first)', () => {
    expect(findShell(registry, 'auto')).toBeUndefined()
  })
})

describe('WSL id helpers', () => {
  test('isWslId recognises wsl-prefixed ids', () => {
    expect(isWslId('wsl:Ubuntu')).toBe(true)
    expect(isWslId('wsl:Ubuntu-22.04')).toBe(true)
    expect(isWslId('wsl')).toBe(false)
    expect(isWslId('powershell')).toBe(false)
    expect(isWslId('')).toBe(false)
  })

  test('parseWslDistro extracts the distro name', () => {
    expect(parseWslDistro('wsl:Ubuntu')).toBe('Ubuntu')
    expect(parseWslDistro('wsl:Ubuntu-22.04')).toBe('Ubuntu-22.04')
    expect(parseWslDistro('powershell')).toBeUndefined()
    expect(parseWslDistro('wsl:')).toBeUndefined()
  })
})
