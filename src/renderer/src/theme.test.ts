import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  applyTheme,
  isThemePreference,
  resolveAppliedTheme,
  sanitizeThemePreference,
  THEME_PREFERENCES,
} from './theme'

type MediaQueryListener = (event: { matches: boolean }) => void

function stubMatchMedia(matches: boolean): () => void {
  const listeners = new Set<MediaQueryListener>()
  const original = globalThis.matchMedia

  globalThis.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (_: string, handler: MediaQueryListener) => {
      listeners.add(handler)
    },
    removeEventListener: (_: string, handler: MediaQueryListener) => {
      listeners.delete(handler)
    },
    addListener: (handler: MediaQueryListener) => {
      listeners.add(handler)
    },
    removeListener: (handler: MediaQueryListener) => {
      listeners.delete(handler)
    },
    dispatchEvent: () => true,
  })) as typeof globalThis.matchMedia

  return () => {
    if (original) {
      globalThis.matchMedia = original
    } else {
      // @ts-expect-error cleanup when the original was undefined
      delete globalThis.matchMedia
    }
  }
}

function stubDocument(): { restore: () => void; root: { dataset: Record<string, string>; style: { colorScheme: string }; setAttribute: (key: string, value: string) => void; removeAttribute: (key: string) => void } } {
  const dataset: Record<string, string> = {}
  const style = { colorScheme: '' }
  const root = {
    dataset,
    style,
    setAttribute(key: string, value: string) {
      if (key === 'data-theme') dataset.theme = value
    },
    removeAttribute(key: string) {
      if (key === 'data-theme') delete dataset.theme
    },
  }
  const original = globalThis.document
  // @ts-expect-error minimal document shim for tests
  globalThis.document = { documentElement: root }
  return {
    root,
    restore: () => {
      if (original) {
        globalThis.document = original
      } else {
        // @ts-expect-error cleanup when the original was undefined
        delete globalThis.document
      }
    },
  }
}

describe('theme preferences', () => {
  test('THEME_PREFERENCES lists system, light, and dark in order', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark'])
  })

  test('isThemePreference recognises valid preferences', () => {
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference(undefined)).toBe(false)
  })

  test('sanitizeThemePreference defaults to system when input is invalid or missing', () => {
    expect(sanitizeThemePreference(undefined)).toBe('system')
    expect(sanitizeThemePreference(null)).toBe('system')
    expect(sanitizeThemePreference('sepia')).toBe('system')
    expect(sanitizeThemePreference(42)).toBe('system')
    expect(sanitizeThemePreference('light')).toBe('light')
    expect(sanitizeThemePreference('dark')).toBe('dark')
    expect(sanitizeThemePreference('system')).toBe('system')
  })
})

describe('resolveAppliedTheme', () => {
  let restoreMedia: (() => void) | null = null

  afterEach(() => {
    restoreMedia?.()
    restoreMedia = null
  })

  test('returns light when preference is light regardless of the system', () => {
    restoreMedia = stubMatchMedia(true)
    expect(resolveAppliedTheme('light')).toBe('light')
  })

  test('returns dark when preference is dark regardless of the system', () => {
    restoreMedia = stubMatchMedia(false)
    expect(resolveAppliedTheme('dark')).toBe('dark')
  })

  test('follows the system when preference is system', () => {
    restoreMedia = stubMatchMedia(false)
    expect(resolveAppliedTheme('system')).toBe('light')
    restoreMedia()

    restoreMedia = stubMatchMedia(true)
    expect(resolveAppliedTheme('system')).toBe('dark')
  })

  test('falls back to dark when matchMedia is unavailable', () => {
    const original = globalThis.matchMedia
    // @ts-expect-error force removal
    delete globalThis.matchMedia
    try {
      expect(resolveAppliedTheme('system')).toBe('dark')
    } finally {
      if (original) globalThis.matchMedia = original
    }
  })
})

describe('applyTheme', () => {
  let cleanup: Array<() => void> = []

  beforeEach(() => {
    cleanup = []
  })

  afterEach(() => {
    while (cleanup.length) cleanup.pop()?.()
  })

  test('writes data-theme and color-scheme on the document root for light', () => {
    const media = stubMatchMedia(false)
    cleanup.push(media)
    const doc = stubDocument()
    cleanup.push(doc.restore)

    applyTheme('light')
    expect(doc.root.dataset.theme).toBe('light')
    expect(doc.root.style.colorScheme).toBe('light')
  })

  test('writes data-theme and color-scheme on the document root for dark', () => {
    const media = stubMatchMedia(false)
    cleanup.push(media)
    const doc = stubDocument()
    cleanup.push(doc.restore)

    applyTheme('dark')
    expect(doc.root.dataset.theme).toBe('dark')
    expect(doc.root.style.colorScheme).toBe('dark')
  })

  test('applies the system-resolved theme when preference is system', () => {
    const media = stubMatchMedia(true)
    cleanup.push(media)
    const doc = stubDocument()
    cleanup.push(doc.restore)

    applyTheme('system')
    expect(doc.root.dataset.theme).toBe('dark')
    expect(doc.root.style.colorScheme).toBe('dark')
  })
})
