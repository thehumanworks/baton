import { describe, expect, test } from 'bun:test'
import electronViteConfig from './electron.vite.config'

describe('electron-vite config', () => {
  test('builds the preload bridge for dev and packaged Electron apps', () => {
    const config = typeof electronViteConfig === 'function'
      ? electronViteConfig({ command: 'build', mode: 'production' })
      : electronViteConfig

    expect(config).toHaveProperty('preload')
    expect(config.preload).toBeDefined()
  })
})
