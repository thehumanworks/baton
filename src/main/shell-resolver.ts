import {
  findShell,
  isWslId,
  parseWslDistro,
  type ShellDescriptor,
} from '../shared/shell-registry'

export interface DetectInput {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  registry: readonly ShellDescriptor[]
}

export function detectPreferredShellId(input: DetectInput): string {
  if (input.platform === 'win32') {
    if (input.registry.some((d) => d.id === 'pwsh')) return 'pwsh'
    if (input.registry.some((d) => d.id === 'powershell')) return 'powershell'
    if (input.registry.some((d) => d.id === 'cmd')) return 'cmd'
    return input.registry[0]?.id ?? 'cmd'
  }

  const loginShell = input.env.SHELL
  if (loginShell) {
    const match = input.registry.find((d) => d.file === loginShell)
    if (match) return match.id
  }

  if (input.platform === 'darwin') {
    const zsh = input.registry.find((d) => d.id === 'zsh' || d.file === '/bin/zsh')
    if (zsh) return zsh.id
  }

  const bash = input.registry.find((d) => d.id === 'bash' || d.file === '/bin/bash')
  if (bash) return bash.id

  return input.registry[0]?.id ?? 'sh'
}

const DRIVE_PATTERN = /^([A-Za-z]):\\?(.*)$/

export function toWslPath(input: string): string {
  const match = DRIVE_PATTERN.exec(input)
  if (!match) return input
  const drive = match[1]!.toLowerCase()
  const rest = match[2]!.replace(/\\/g, '/').replace(/\/+$/, '')
  return rest.length > 0 ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`
}

export interface ResolveInput {
  id: string
  registry: readonly ShellDescriptor[]
  cwd: string
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
}

export interface ResolvedShell {
  descriptor: ShellDescriptor
  file: string
  args: string[]
  env: Record<string, string>
  cwd: string
  fallbackReason?: string
}

const WSL_ENV_KEYS = ['LANG', 'LC_ALL'] as const

export function resolveShell(input: ResolveInput): ResolvedShell {
  let descriptor = findShell(input.registry, input.id)
  let fallbackReason: string | undefined

  if (!descriptor) {
    const preferredId = detectPreferredShellId(input)
    descriptor = findShell(input.registry, preferredId)
    if (input.id !== 'auto') {
      fallbackReason = `Shell id "${input.id}" is not available; falling back to ${preferredId}.`
    }
  }

  if (!descriptor) {
    throw new Error('No shell descriptors available')
  }

  if (descriptor.kind === 'wsl') {
    return resolveWsl(descriptor, input, fallbackReason)
  }

  return resolveNative(descriptor, input, fallbackReason)
}

function resolveNative(
  descriptor: ShellDescriptor,
  input: ResolveInput,
  fallbackReason: string | undefined,
): ResolvedShell {
  const env = normaliseEnv({
    ...input.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: input.env.LANG || 'en_US.UTF-8',
    LC_ALL: input.env.LC_ALL || input.env.LANG || 'en_US.UTF-8',
  })

  return {
    descriptor,
    file: descriptor.file,
    args: [...descriptor.args],
    env,
    cwd: input.cwd,
    fallbackReason,
  }
}

function resolveWsl(
  descriptor: ShellDescriptor,
  input: ResolveInput,
  fallbackReason: string | undefined,
): ResolvedShell {
  const distro = descriptor.meta?.wslDistro
    ?? (isWslId(descriptor.id) ? parseWslDistro(descriptor.id) : undefined)

  const args = [...descriptor.args]
  if (distro && !args.includes('-d')) {
    args.push('-d', distro)
  }
  args.push('--cd', input.cwd)

  const env: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: input.env.LANG || 'en_US.UTF-8',
    LC_ALL: input.env.LC_ALL || input.env.LANG || 'en_US.UTF-8',
    WSL_UTF8: '1',
  }
  for (const key of WSL_ENV_KEYS) {
    const value = input.env[key]
    if (value) env[key] = value
  }

  return {
    descriptor,
    file: descriptor.file,
    args,
    env,
    cwd: input.cwd,
    fallbackReason,
  }
}

function normaliseEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}
