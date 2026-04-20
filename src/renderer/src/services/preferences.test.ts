import { describe, expect, test } from 'bun:test'
import { shouldShowFirstRunPrompt, resolveDefaultShellLabel } from './preferences'
import type { AppPreferences } from '@shared/preferences-types'
import type { ShellDescriptorDTO } from '@shared/terminal-types'

const PREFS_AUTO: AppPreferences = { version: 1, terminal: { defaultShellId: 'auto' } }
const PREFS_CONCRETE: AppPreferences = { version: 1, terminal: { defaultShellId: 'pwsh' } }

describe('shouldShowFirstRunPrompt', () => {
  test('returns true only on win32 when prefs are fresh and defaultShellId is auto', () => {
    expect(
      shouldShowFirstRunPrompt({ platform: 'win32', wasFreshlyCreated: true, preferences: PREFS_AUTO }),
    ).toBe(true)
  })

  test('returns false on darwin even when fresh and auto', () => {
    expect(
      shouldShowFirstRunPrompt({ platform: 'darwin', wasFreshlyCreated: true, preferences: PREFS_AUTO }),
    ).toBe(false)
  })

  test('returns false on linux even when fresh and auto', () => {
    expect(
      shouldShowFirstRunPrompt({ platform: 'linux', wasFreshlyCreated: true, preferences: PREFS_AUTO }),
    ).toBe(false)
  })

  test('returns false on win32 when the user has already saved a concrete shell', () => {
    expect(
      shouldShowFirstRunPrompt({ platform: 'win32', wasFreshlyCreated: false, preferences: PREFS_CONCRETE }),
    ).toBe(false)
  })

  test('returns false on win32 when prefs already existed on disk (wasFreshlyCreated=false)', () => {
    expect(
      shouldShowFirstRunPrompt({ platform: 'win32', wasFreshlyCreated: false, preferences: PREFS_AUTO }),
    ).toBe(false)
  })
})

const SHELLS: ShellDescriptorDTO[] = [
  { id: 'powershell', label: 'Windows PowerShell', kind: 'native' },
  { id: 'pwsh', label: 'PowerShell 7', kind: 'native' },
  { id: 'wsl:Ubuntu', label: 'WSL · Ubuntu', kind: 'wsl', wslDistro: 'Ubuntu' },
]

describe('resolveDefaultShellLabel', () => {
  test('returns the label of the descriptor matched by defaultShellId', () => {
    expect(resolveDefaultShellLabel(PREFS_CONCRETE, SHELLS, 'pwsh')).toBe('PowerShell 7')
  })

  test('falls back to the backend-reported default when id is auto', () => {
    expect(resolveDefaultShellLabel(PREFS_AUTO, SHELLS, 'pwsh')).toBe('PowerShell 7')
  })

  test('returns undefined when nothing resolves', () => {
    expect(resolveDefaultShellLabel({ version: 1, terminal: { defaultShellId: 'nonexistent' } }, SHELLS, 'nonexistent-too'))
      .toBeUndefined()
  })

  test('does not confuse the auto id with a missing descriptor when backend default is known', () => {
    expect(resolveDefaultShellLabel(PREFS_AUTO, SHELLS, 'wsl:Ubuntu')).toBe('WSL · Ubuntu')
  })
})
