import { describe, expect, test } from 'bun:test'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  createTerminalStartCommandInjector,
} from './terminal-start-command'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('createTerminalStartCommandInjector', () => {
  test('injects the full command after shell output goes quiet', async () => {
    const writes: string[] = []
    const injector = createTerminalStartCommandInjector(
      (data) => writes.push(data),
      {
        startCommand: 'pi --model openai-codex/gpt-5.3-codex-spark',
        quietMs: 25,
        fallbackMs: 200,
      },
    )

    expect(injector).not.toBeNull()

    injector!.observeOutput('\x1b[1mready\x1b[0m')
    expect(writes).toEqual([])

    await delay(60)

    expect(writes).toEqual(['pi --model openai-codex/gpt-5.3-codex-spark\r'])
  })

  test('uses bracketed paste when the shell enables it', async () => {
    const writes: string[] = []
    const injector = createTerminalStartCommandInjector(
      (data) => writes.push(data),
      {
        startCommand: 'pi --model openai-codex/gpt-5.3-codex-spark',
        quietMs: 25,
        fallbackMs: 200,
      },
    )

    injector!.observeOutput('\x1b[?200')
    injector!.observeOutput('4h')

    await delay(60)

    expect(writes).toEqual([
      `${BRACKETED_PASTE_START}pi --model openai-codex/gpt-5.3-codex-spark${BRACKETED_PASTE_END}\r`,
    ])
  })

  test('falls back when the shell stays silent', async () => {
    const writes: string[] = []
    createTerminalStartCommandInjector(
      (data) => writes.push(data),
      {
        startCommand: 'pi --model openai-codex/gpt-5.3-codex-spark',
        quietMs: 100,
        fallbackMs: 40,
      },
    )

    await delay(80)

    expect(writes).toEqual(['pi --model openai-codex/gpt-5.3-codex-spark\r'])
  })

  test('dispose cancels a pending injection', async () => {
    const writes: string[] = []
    const injector = createTerminalStartCommandInjector(
      (data) => writes.push(data),
      {
        startCommand: 'pi --model openai-codex/gpt-5.3-codex-spark',
        quietMs: 25,
        fallbackMs: 200,
      },
    )

    injector!.observeOutput('prompt')
    injector!.dispose()

    await delay(60)

    expect(writes).toEqual([])
  })
})
