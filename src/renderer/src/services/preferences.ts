import type { AppPreferences } from '@shared/preferences-types'
import type { ShellDescriptorDTO } from '@shared/terminal-types'

export interface FirstRunInput {
  platform: NodeJS.Platform
  wasFreshlyCreated: boolean
  preferences: AppPreferences
}

export function shouldShowFirstRunPrompt(input: FirstRunInput): boolean {
  if (input.platform !== 'win32') return false
  if (!input.wasFreshlyCreated) return false
  return input.preferences.terminal.defaultShellId === 'auto'
}

export function resolveDefaultShellLabel(
  preferences: AppPreferences,
  shells: readonly ShellDescriptorDTO[],
  backendDefaultShellId: string,
): string | undefined {
  const effectiveId =
    preferences.terminal.defaultShellId === 'auto'
      ? backendDefaultShellId
      : preferences.terminal.defaultShellId
  return shells.find((s) => s.id === effectiveId)?.label
}
