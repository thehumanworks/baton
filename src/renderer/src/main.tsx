import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { applyTheme } from './theme'
import { installViewportHeightBinding } from './services/viewportHeight'
import { loadAppState } from './persistence'

// Apply the saved theme preference before the first render so the UI paints
// in the right palette instead of flashing the default dark palette.
applyTheme(loadAppState().themePreference)

// Keep the app's logical height in sync with the visual viewport so the
// mobile soft keyboard shrinks the usable area rather than covering the
// terminal input line.
installViewportHeightBinding()

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Missing #root element')
}

createRoot(rootElement).render(<App />)
