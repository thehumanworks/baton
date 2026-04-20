import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import {
  applyTheme,
  resolveAppliedTheme,
  subscribeToSystemTheme,
  type AppliedTheme,
  type ThemePreference,
} from '../theme'

interface ThemeContextValue {
  preference: ThemePreference
  appliedTheme: AppliedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

interface ThemeProviderProps {
  preference: ThemePreference
  onPreferenceChange: (preference: ThemePreference) => void
  children: ReactNode
}

export function ThemeProvider(props: ThemeProviderProps) {
  const [appliedTheme, setAppliedTheme] = useState<AppliedTheme>(() =>
    resolveAppliedTheme(props.preference),
  )

  useEffect(() => {
    setAppliedTheme(applyTheme(props.preference))
  }, [props.preference])

  useEffect(() => {
    if (props.preference !== 'system') return
    return subscribeToSystemTheme(() => {
      setAppliedTheme(applyTheme('system'))
    })
  }, [props.preference])

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference: props.preference,
      appliedTheme,
      setPreference: props.onPreferenceChange,
    }),
    [props.preference, appliedTheme, props.onPreferenceChange],
  )

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useThemeContext(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('ThemeContext is missing')
  return value
}
