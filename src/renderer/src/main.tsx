import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { applyTheme } from './theme'
import { loadAppState } from './persistence'

// Apply the saved theme preference before the first render so the UI paints
// in the right palette instead of flashing the default dark palette.
applyTheme(loadAppState().themePreference)

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Missing #root element')
}

createRoot(rootElement).render(<App />)
