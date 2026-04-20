import { THEME_PREFERENCES, type ThemePreference } from '../theme'
import { useThemeContext } from '../services/themeContext'

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

const ICONS: Record<ThemePreference, string> = {
  system: '🖥',
  light: '☀',
  dark: '☾',
}

interface ThemeToggleProps {
  compact?: boolean
}

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { preference, setPreference } = useThemeContext()

  return (
    <div
      className="theme-toggle"
      role="radiogroup"
      aria-label="Colour theme"
      title={`Theme: ${LABELS[preference]}`}
    >
      {THEME_PREFERENCES.map((option) => {
        const active = option === preference
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-pressed={active}
            aria-label={LABELS[option]}
            className="theme-toggle-option app-region-no-drag"
            onClick={() => setPreference(option)}
          >
            <span aria-hidden className="theme-toggle-option-icon">
              {ICONS[option]}
            </span>
            {compact ? null : LABELS[option]}
          </button>
        )
      })}
    </div>
  )
}
