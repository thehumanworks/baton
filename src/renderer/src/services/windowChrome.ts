import { useEffect, useState } from 'react'

const MAC_TITLEBAR_INSET_PX = 82
const TITLEBAR_INSET_VAR = '--titlebar-inset'

function isMacDesktop(): boolean {
  return typeof window !== 'undefined' && window.baton?.platform === 'darwin'
}

export function useFullScreen(): boolean {
  const [isFullScreen, setIsFullScreen] = useState(false)

  useEffect(() => {
    const bridge = window.baton?.window
    if (!bridge) return

    let cancelled = false
    void bridge.isFullScreen().then((value) => {
      if (!cancelled) setIsFullScreen(value)
    })

    const unsubscribe = bridge.onFullScreenChange(setIsFullScreen)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return isFullScreen
}

/**
 * Reserves horizontal space for the native macOS traffic lights by exposing
 * a `--titlebar-inset` custom property on the document root. Collapses to 0
 * in full-screen mode (where the traffic lights are hidden) and on every
 * non-mac platform.
 */
export function useTitlebarInset(): number {
  const isFullScreen = useFullScreen()
  const inset = isMacDesktop() && !isFullScreen ? MAC_TITLEBAR_INSET_PX : 0

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(TITLEBAR_INSET_VAR, `${inset}px`)
    return () => {
      root.style.removeProperty(TITLEBAR_INSET_VAR)
    }
  }, [inset])

  return inset
}
