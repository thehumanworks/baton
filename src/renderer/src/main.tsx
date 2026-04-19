import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Missing #root element')
}

createRoot(rootElement).render(<App />)
