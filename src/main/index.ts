import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import crypto from 'node:crypto'
import * as pty from 'node-pty'
import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalResizeRequest,
  TerminalWriteRequest
} from '../shared/terminal-types'

const terminals = new Map<string, pty.IPty>()
let mainWindow: BrowserWindow | null = null

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL)

function resolveWindowIconPath(): string | null {
  // In a packaged app, extraResources are placed under process.resourcesPath.
  // In dev, we fall back to the repo's build/icons/icon.png.
  const packaged = path.join(process.resourcesPath, 'icon.png')
  if (fs.existsSync(packaged)) return packaged
  const dev = path.resolve(__dirname, '../../build/icons/icon.png')
  if (fs.existsSync(dev)) return dev
  return null
}

function getDefaultShell(): string {
  if (process.platform === 'win32') return process.env.ComSpec || 'powershell.exe'
  if (process.platform === 'darwin') return process.env.SHELL || '/bin/zsh'
  return process.env.SHELL || '/bin/bash'
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function expandHomePrefix(input: string, home: string): string {
  if (input === '~') return home
  if (input.startsWith('~/')) return path.join(home, input.slice(2))
  if (process.platform === 'win32' && input.startsWith('~\\')) {
    return path.join(home, input.slice(2))
  }
  return input
}

function expandEnvVars(input: string): string {
  if (process.platform === 'win32') {
    return input.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? '')
  }
  return input.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced?: string, bare?: string) => {
    const name = braced ?? bare
    if (!name) return ''
    return process.env[name] ?? ''
  })
}

function resolveWorkspaceCwd(requested?: string): string {
  const home = os.homedir()
  if (!requested) return home

  const trimmed = requested.trim()
  if (!trimmed) return home

  const expanded = path.normalize(expandEnvVars(expandHomePrefix(trimmed, home)))
  if (!path.isAbsolute(expanded)) return home

  try {
    const stat = fs.statSync(expanded)
    if (!stat.isDirectory()) return home
  } catch {
    return home
  }

  return expanded
}

function createWindow(): void {
  const iconPath = resolveWindowIconPath()
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'Baton',
    backgroundColor: '#080b12',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    icon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (isDevelopment && process.platform === 'darwin' && icon && app.dock) {
    app.dock.setIcon(icon)
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const broadcastFullScreen = (isFullScreen: boolean): void => {
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send('window:fullscreen-changed', isFullScreen)
  }
  mainWindow.on('enter-full-screen', () => broadcastFullScreen(true))
  mainWindow.on('leave-full-screen', () => broadcastFullScreen(false))

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDevelopment && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    if (process.env.BATON_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function createTerminal(event: Electron.IpcMainInvokeEvent, request: TerminalCreateRequest): TerminalCreateResponse {
  const terminalId = crypto.randomUUID()
  const shellPath = request.shell || getDefaultShell()
  const cols = clampInteger(request.cols, 10, 500, 100)
  const rows = clampInteger(request.rows, 4, 200, 30)
  const cwd = resolveWorkspaceCwd(request.cwd)

  const terminal = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
      HOME: process.env.HOME || os.homedir()
    }
  })

  terminals.set(terminalId, terminal)

  terminal.onData((data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('terminal:data', { terminalId, data })
    }
  })

  terminal.onExit(({ exitCode, signal }) => {
    terminals.delete(terminalId)
    if (!event.sender.isDestroyed()) {
      event.sender.send('terminal:exit', { terminalId, exitCode, signal })
    }
  })

  return {
    terminalId,
    shell: path.basename(shellPath),
    pid: terminal.pid,
    cwd
  }
}

ipcMain.handle('terminal:create', (event, request: TerminalCreateRequest) => {
  return createTerminal(event, request)
})

ipcMain.on('terminal:write', (_event, request: TerminalWriteRequest) => {
  if (!request || typeof request.terminalId !== 'string' || typeof request.data !== 'string') return
  if (request.data.length > 65536) return
  terminals.get(request.terminalId)?.write(request.data)
})

ipcMain.on('terminal:resize', (_event, request: TerminalResizeRequest) => {
  if (!request || typeof request.terminalId !== 'string') return
  const terminal = terminals.get(request.terminalId)
  if (!terminal) return

  const cols = clampInteger(request.cols, 10, 500, 100)
  const rows = clampInteger(request.rows, 4, 200, 30)
  terminal.resize(cols, rows)
})

ipcMain.handle('workspace:pick-directory', async (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender)
  const result = await (sender
    ? dialog.showOpenDialog(sender, { properties: ['openDirectory', 'dontAddToRecent'] })
    : dialog.showOpenDialog({ properties: ['openDirectory', 'dontAddToRecent'] }))

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }

  return { canceled: false, path: result.filePaths[0] }
})

ipcMain.handle('window:is-fullscreen', (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender)
  return sender ? sender.isFullScreen() : false
})

ipcMain.handle('terminal:close', (_event, request: TerminalCloseRequest) => {
  if (!request || typeof request.terminalId !== 'string') return false
  const terminal = terminals.get(request.terminalId)
  if (!terminal) return false

  try {
    terminal.kill()
  } finally {
    terminals.delete(request.terminalId)
  }

  return true
})

function killAllTerminals(): void {
  for (const [terminalId, terminal] of terminals) {
    try {
      terminal.kill()
    } catch {
      // Ignore shutdown errors.
    } finally {
      terminals.delete(terminalId)
    }
  }
}

void app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', killAllTerminals)

app.on('window-all-closed', () => {
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})
