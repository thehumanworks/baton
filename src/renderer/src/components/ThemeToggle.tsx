import type { ReactNode } from 'react'
import { THEME_PREFERENCES, type ThemePreference } from '../theme'
import { useThemeContext } from '../services/themeContext'

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

const ICON_SIZE = 12

function IconFrame({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const ICONS: Record<ThemePreference, ReactNode> = {
  system: (
    <IconFrame>
      <rect x="3" y="4" width="18" height="13" rx="1.5" />
      <path d="M9 21h6" />
      <path d="M12 17v4" />
    </IconFrame>
  ),
  light: (
    <IconFrame>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="M5.6 5.6l1.4 1.4" />
      <path d="M17 17l1.4 1.4" />
      <path d="M5.6 18.4l1.4-1.4" />
      <path d="M17 7l1.4-1.4" />
    </IconFrame>
  ),
  dark: (
    <IconFrame>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
    </IconFrame>
  ),
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
