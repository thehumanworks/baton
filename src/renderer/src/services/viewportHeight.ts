const APP_HEIGHT_VAR = '--app-height'

function readViewportHeight(): number {
  if (typeof window === 'undefined') return 0
  const visual = window.visualViewport?.height
  if (typeof visual === 'number' && Number.isFinite(visual) && visual > 0) {
    return visual
  }
  return window.innerHeight
}

function applyHeight(): void {
  if (typeof document === 'undefined') return
  const height = readViewportHeight()
  if (!Number.isFinite(height) || height <= 0) return
  document.documentElement.style.setProperty(APP_HEIGHT_VAR, `${height}px`)
}

/**
 * Binds `--app-height` to the current visual viewport height. Mobile
 * browsers shrink `window.visualViewport.height` when the software keyboard
 * appears, so binding layout to this value ensures our terminal surface
 * reflows above the keyboard instead of hiding behind it.
 *
 * Safe to call multiple times; later calls are no-ops.
 */
export function installViewportHeightBinding(): () => void {
  if (typeof window === 'undefined') return () => {}

  applyHeight()

  const onResize = (): void => {
    applyHeight()
  }

  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onResize)
  window.visualViewport?.addEventListener('resize', onResize)
  window.visualViewport?.addEventListener('scroll', onResize)

  return () => {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('orientationchange', onResize)
    window.visualViewport?.removeEventListener('resize', onResize)
    window.visualViewport?.removeEventListener('scroll', onResize)
  }
}
