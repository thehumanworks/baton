export interface TerminalStartCommandInjector {
  observeOutput(data: string): void
  dispose(): void
}

export interface CreateTerminalStartCommandInjectorOptions {
  startCommand?: string
  quietMs?: number
  fallbackMs?: number
}

export const BRACKETED_PASTE_ENABLE = '\x1b[?2004h'
export const BRACKETED_PASTE_DISABLE = '\x1b[?2004l'
export const BRACKETED_PASTE_START = '\x1b[200~'
export const BRACKETED_PASTE_END = '\x1b[201~'

const DEFAULT_QUIET_MS = 150
const DEFAULT_FALLBACK_MS = 2_000
const CONTROL_SEQUENCE_TAIL_LENGTH = 32

type TimeoutHandle = ReturnType<typeof setTimeout>

export function createTerminalStartCommandInjector(
  write: (data: string) => void,
  options: CreateTerminalStartCommandInjectorOptions,
): TerminalStartCommandInjector | null {
  const command = typeof options.startCommand === 'string' ? options.startCommand : undefined
  if (!command || command.trim().length === 0) return null

  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS
  const fallbackMs = options.fallbackMs ?? DEFAULT_FALLBACK_MS

  let disposed = false
  let injected = false
  let bracketedPasteEnabled = false
  let controlSequenceTail = ''
  let quietTimer: TimeoutHandle | null = null

  const clearQuietTimer = (): void => {
    if (!quietTimer) return
    clearTimeout(quietTimer)
    quietTimer = null
  }

  const inject = (): void => {
    if (disposed || injected) return

    injected = true
    clearQuietTimer()
    clearTimeout(fallbackTimer)

    write(bracketedPasteEnabled
      ? `${BRACKETED_PASTE_START}${command}${BRACKETED_PASTE_END}\r`
      : `${command}\r`)
  }

  const fallbackTimer = setTimeout(inject, fallbackMs)

  return {
    observeOutput(data) {
      if (disposed || injected || data.length === 0) return

      const combined = `${controlSequenceTail}${data}`
      const lastEnable = combined.lastIndexOf(BRACKETED_PASTE_ENABLE)
      const lastDisable = combined.lastIndexOf(BRACKETED_PASTE_DISABLE)
      if (lastEnable !== -1 || lastDisable !== -1) {
        bracketedPasteEnabled = lastEnable > lastDisable
      }
      controlSequenceTail = combined.slice(-CONTROL_SEQUENCE_TAIL_LENGTH)

      clearQuietTimer()
      quietTimer = setTimeout(inject, quietMs)
    },
    dispose() {
      if (disposed) return
      disposed = true
      clearQuietTimer()
      clearTimeout(fallbackTimer)
    },
  }
}
