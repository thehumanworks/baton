import { describe, expect, test } from 'bun:test'
import {
  detectPreferredShellId,
  resolveShell,
  toWslPath,
} from './shell-resolver'
import type { ShellDescriptor } from '../shared/shell-registry'

const unixRegistry: ShellDescriptor[] = [
  { id: 'zsh', kind: 'native', label: 'zsh', file: '/bin/zsh', args: [], platforms: ['darwin', 'linux'] },
  { id: 'bash', kind: 'native', label: 'bash', file: '/bin/bash', args: [], platforms: ['darwin', 'linux'] },
  { id: 'fish', kind: 'native', label: 'fish', file: '/usr/bin/fish', args: [], platforms: ['linux'] },
]

const windowsRegistry: ShellDescriptor[] = [
  { id: 'powershell', kind: 'native', label: 'Windows PowerShell', file: 'powershell.exe', args: ['-NoLogo'], platforms: ['win32'] },
  { id: 'pwsh', kind: 'native', label: 'PowerShell 7', file: 'pwsh.exe', args: ['-NoLogo'], platforms: ['win32'] },
  { id: 'cmd', kind: 'native', label: 'Command Prompt', file: 'cmd.exe', args: [], platforms: ['win32'] },
  { id: 'wsl:Ubuntu', kind: 'wsl', label: 'WSL · Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], platforms: ['win32'], meta: { wslDistro: 'Ubuntu' } },
]

describe('detectPreferredShellId', () => {
  test('returns the id of the $SHELL match on UNIX', () => {
    const id = detectPreferredShellId({
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
      registry: unixRegistry,
    })
    expect(id).toBe('zsh')
  })

  test('returns bash on linux when $SHELL is unset', () => {
    const id = detectPreferredShellId({
      platform: 'linux',
      env: {},
      registry: unixRegistry,
    })
    expect(id).toBe('bash')
  })

  test('returns zsh on darwin when $SHELL is unset and zsh is available', () => {
    const id = detectPreferredShellId({
      platform: 'darwin',
      env: {},
      registry: unixRegistry,
    })
    expect(id).toBe('zsh')
  })

  test('returns pwsh on Windows when it is available', () => {
    const id = detectPreferredShellId({
      platform: 'win32',
      env: {},
      registry: windowsRegistry,
    })
    expect(id).toBe('pwsh')
  })

  test('returns powershell on Windows when pwsh is not installed', () => {
    const id = detectPreferredShellId({
      platform: 'win32',
      env: {},
      registry: windowsRegistry.filter((d) => d.id !== 'pwsh'),
    })
    expect(id).toBe('powershell')
  })

  test('returns cmd on Windows when nothing else is present', () => {
    const id = detectPreferredShellId({
      platform: 'win32',
      env: {},
      registry: [windowsRegistry[2]!],
    })
    expect(id).toBe('cmd')
  })

  test('returns the first registry entry as a last resort', () => {
    const id = detectPreferredShellId({
      platform: 'linux',
      env: {},
      registry: [unixRegistry[2]!],
    })
    expect(id).toBe('fish')
  })
})

describe('toWslPath', () => {
  test('translates a C: drive path to /mnt/c form', () => {
    expect(toWslPath('C:\\Users\\mish\\Development\\foo')).toBe('/mnt/c/Users/mish/Development/foo')
  })

  test('lower-cases the drive letter', () => {
    expect(toWslPath('D:\\Projects')).toBe('/mnt/d/Projects')
  })

  test('leaves unix-style paths untouched', () => {
    expect(toWslPath('/home/mish/projects')).toBe('/home/mish/projects')
  })

  test('handles trailing backslashes', () => {
    expect(toWslPath('C:\\Users\\mish\\')).toBe('/mnt/c/Users/mish')
  })

  test('returns unchanged input when it does not match a drive pattern', () => {
    expect(toWslPath('relative/path')).toBe('relative/path')
  })
})

describe('resolveShell', () => {
  test('returns the descriptor unchanged for a native shell', () => {
    const resolved = resolveShell({
      id: 'zsh',
      registry: unixRegistry,
      cwd: '/home/mish',
      platform: 'linux',
      env: { HOME: '/home/mish' },
    })

    expect(resolved.file).toBe('/bin/zsh')
    expect(resolved.args).toEqual([])
    expect(resolved.cwd).toBe('/home/mish')
  })

  test('native shells inherit the provided env', () => {
    const resolved = resolveShell({
      id: 'zsh',
      registry: unixRegistry,
      cwd: '/home/mish',
      platform: 'linux',
      env: { HOME: '/home/mish', CUSTOM: 'keep-me' },
    })

    expect(resolved.env.HOME).toBe('/home/mish')
    expect(resolved.env.CUSTOM).toBe('keep-me')
    expect(resolved.env.TERM).toBe('xterm-256color')
    expect(resolved.env.COLORTERM).toBe('truecolor')
  })

  test('wsl shells spawn wsl.exe with -d <distro> --cd <cwd>', () => {
    const resolved = resolveShell({
      id: 'wsl:Ubuntu',
      registry: windowsRegistry,
      cwd: 'C:\\Users\\mish\\Development\\foo',
      platform: 'win32',
      env: { PATH: 'C:\\Windows;C:\\Windows\\System32', USERNAME: 'mish' },
    })

    expect(resolved.file).toBe('wsl.exe')
    expect(resolved.args).toContain('-d')
    expect(resolved.args).toContain('Ubuntu')
    expect(resolved.args).toContain('--cd')
    const cdIdx = resolved.args.indexOf('--cd')
    expect(resolved.args[cdIdx + 1]).toBe('C:\\Users\\mish\\Development\\foo')
  })

  test('wsl shells attach a strict minimal env with no PATH inheritance', () => {
    const resolved = resolveShell({
      id: 'wsl:Ubuntu',
      registry: windowsRegistry,
      cwd: 'C:\\Users\\mish',
      platform: 'win32',
      env: { PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\mish', ComSpec: 'cmd.exe' },
    })

    expect(resolved.env.PATH).toBeUndefined()
    expect(resolved.env.USERPROFILE).toBeUndefined()
    expect(resolved.env.ComSpec).toBeUndefined()
    expect(resolved.env.TERM).toBe('xterm-256color')
    expect(resolved.env.COLORTERM).toBe('truecolor')
    expect(resolved.env.WSL_UTF8).toBe('1')
  })

  test('wsl shells carry through LANG/LC_ALL when present in incoming env', () => {
    const resolved = resolveShell({
      id: 'wsl:Ubuntu',
      registry: windowsRegistry,
      cwd: 'C:\\Users\\mish',
      platform: 'win32',
      env: { LANG: 'en_GB.UTF-8', LC_ALL: 'en_GB.UTF-8' },
    })

    expect(resolved.env.LANG).toBe('en_GB.UTF-8')
    expect(resolved.env.LC_ALL).toBe('en_GB.UTF-8')
  })

  test('wsl shells default LANG to en_US.UTF-8 when unset', () => {
    const resolved = resolveShell({
      id: 'wsl:Ubuntu',
      registry: windowsRegistry,
      cwd: 'C:\\Users\\mish',
      platform: 'win32',
      env: {},
    })

    expect(resolved.env.LANG).toBe('en_US.UTF-8')
    expect(resolved.env.LC_ALL).toBe('en_US.UTF-8')
  })

  test('auto resolves via detectPreferredShellId', () => {
    const resolved = resolveShell({
      id: 'auto',
      registry: unixRegistry,
      cwd: '/home/mish',
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
    })

    expect(resolved.descriptor.id).toBe('zsh')
    expect(resolved.file).toBe('/bin/zsh')
  })

  test('unknown ids fall back to the auto-detected descriptor and flag it', () => {
    const resolved = resolveShell({
      id: 'does-not-exist',
      registry: unixRegistry,
      cwd: '/home/mish',
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
    })

    expect(resolved.descriptor.id).toBe('zsh')
    expect(resolved.fallbackReason).toBeDefined()
    expect(resolved.fallbackReason).toContain('does-not-exist')
  })
})
