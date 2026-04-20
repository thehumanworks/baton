export interface TerminalPreferences {
  defaultShellId: string
  defaultWslDistro?: string
}

export interface AppPreferences {
  version: 1
  terminal: TerminalPreferences
}

export const CURRENT_PREFERENCES_VERSION = 1

export const DEFAULT_PREFERENCES: AppPreferences = {
  version: CURRENT_PREFERENCES_VERSION,
  terminal: { defaultShellId: 'auto' },
}
