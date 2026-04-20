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

export function ThemeToggle() {
  const { preference, setPreference } = useThemeContext()
  const activeIndex = THEME_PREFERENCES.indexOf(preference)
  const optionCount = THEME_PREFERENCES.length

  return (
    <div
      className="theme-toggle"
      role="radiogroup"
      aria-label="Colour theme"
      title={`Theme: ${LABELS[preference]}`}
      style={{ ['--theme-toggle-count' as string]: optionCount }}
    >
      <span
        aria-hidden
        className="theme-toggle-thumb"
        style={{ ['--theme-toggle-index' as string]: activeIndex }}
      />
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
            title={LABELS[option]}
            className="theme-toggle-option app-region-no-drag"
            onClick={() => setPreference(option)}
          >
            <span aria-hidden className="theme-toggle-option-icon">
              {ICONS[option]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
