export type ThemePreference = 'system' | 'light' | 'dark'
export type AppliedTheme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

const PREFERENCE_SET = new Set<ThemePreference>(THEME_PREFERENCES)

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && PREFERENCE_SET.has(value as ThemePreference)
}

export function sanitizeThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : 'system'
}

export function resolveAppliedTheme(preference: ThemePreference): AppliedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'

  const mediaQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mediaQuery) return 'dark'
  return mediaQuery.matches ? 'dark' : 'light'
}

export function applyTheme(preference: ThemePreference): AppliedTheme {
  const applied = resolveAppliedTheme(preference)
  const root = globalThis.document?.documentElement
  if (!root) return applied
  root.setAttribute('data-theme', applied)
  root.style.colorScheme = applied
  return applied
}

export function subscribeToSystemTheme(listener: (theme: AppliedTheme) => void): () => void {
  const mediaQuery = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mediaQuery) return () => {}
  const handler = (event: MediaQueryListEvent): void => {
    listener(event.matches ? 'dark' : 'light')
  }
  mediaQuery.addEventListener('change', handler)
  return () => mediaQuery.removeEventListener('change', handler)
}
