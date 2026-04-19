import { createContext, useContext } from 'react'
import type { BufferedTerminalClient } from './terminalClient'

export const TerminalClientContext = createContext<BufferedTerminalClient | null>(null)

export function useTerminalClient(): BufferedTerminalClient {
  const client = useContext(TerminalClientContext)
  if (!client) throw new Error('TerminalClientContext is missing')
  return client
}
