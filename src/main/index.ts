import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import crypto from 'node:crypto'
import * as pty from 'node-pty'
import type {
  AgentSessionCloseRequest,
  AgentSessionCreateRequest,
  AgentSessionGetRequest,
  AgentSessionResizeRequest,
  AgentSessionWriteRequest,
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalListShellsResponse,
  TerminalResizeRequest,
  TerminalWriteRequest
} from '../shared/terminal-types'
import type { AppPreferences } from '../shared/preferences-types'
import type { ShellDescriptor } from '../shared/shell-registry'
import { detectPreferredShellId, resolveShell } from './shell-resolver'
import { detectShells } from './shell-detection'
import { createPreferencesStore, migratePreferences, type PreferencesStore } from './preferences'
import { AgentSessionManager } from './agent-session-manager'

const terminals = new Map<string, pty.IPty>()
let mainWindow: BrowserWindow | null = null

let shellRegistry: ShellDescriptor[] = []
let preferencesStore: PreferencesStore | null = null
let preferencesWereFreshlyCreated = false
let agentSessionManager: AgentSessionManager | null = null

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

async function resolveEffectiveShellId(request: TerminalCreateRequest): Promise<string> {
  if (request.shellId && request.shellId !== 'auto') return request.shellId

  if (preferencesStore) {
    const prefs = await preferencesStore.load()
    if (prefs.terminal.defaultShellId && prefs.terminal.defaultShellId !== 'auto') {
      return prefs.terminal.defaultShellId
    }
  }

  return 'auto'
}

async function createTerminal(
  event: Electron.IpcMainInvokeEvent,
  request: TerminalCreateRequest,
): Promise<TerminalCreateResponse> {
  const terminalId = crypto.randomUUID()
  const cols = clampInteger(request.cols, 10, 500, 100)
  const rows = clampInteger(request.rows, 4, 200, 30)
  const cwd = resolveWorkspaceCwd(request.cwd)

  const effectiveId = await resolveEffectiveShellId(request)
  const resolved = resolveShell({
    id: effectiveId,
    registry: shellRegistry,
    cwd,
    platform: process.platform,
    env: {
      ...process.env,
      HOME: process.env.HOME || os.homedir(),
    },
  })

  const terminal = pty.spawn(resolved.file, resolved.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: resolved.cwd,
    env: resolved.env,
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
    shell: resolved.descriptor.label,
    shellId: resolved.descriptor.id,
    pid: terminal.pid,
    cwd: resolved.cwd,
  }
}

function getAgentSessionManager(): AgentSessionManager {
  if (!agentSessionManager) {
    throw new Error('Agent session manager not initialised')
  }
  return agentSessionManager
}

ipcMain.handle('terminal:create', (event, request: TerminalCreateRequest) => {
  return createTerminal(event, request)
})

ipcMain.handle('terminal:list-shells', (): TerminalListShellsResponse => {
  const defaultShellId = detectPreferredShellId({
    platform: process.platform,
    env: process.env,
    registry: shellRegistry,
  })
  return {
    shells: shellRegistry.map((d) => ({
      id: d.id,
      label: d.label,
      kind: d.kind,
      ...(d.meta?.wslDistro ? { wslDistro: d.meta.wslDistro } : {}),
    })),
    defaultShellId,
  }
})

ipcMain.handle('agentSession:create', (_event, request: AgentSessionCreateRequest) => {
  return getAgentSessionManager().create(request)
})

ipcMain.handle('agentSession:list', () => {
  return getAgentSessionManager().list()
})

ipcMain.handle('agentSession:get', (_event, request: AgentSessionGetRequest) => {
  if (!request || typeof request.sessionId !== 'string') return null
  return getAgentSessionManager().get(request)
})

ipcMain.handle('preferences:get', async (): Promise<AppPreferences> => {
  if (!preferencesStore) throw new Error('Preferences not initialised')
  return preferencesStore.load()
})

ipcMain.handle('preferences:set', async (_event, next: AppPreferences): Promise<AppPreferences> => {
  if (!preferencesStore) throw new Error('Preferences not initialised')
  const migrated = migratePreferences(next)
  await preferencesStore.save(migrated)
  preferencesWereFreshlyCreated = false
  return migrated
})

ipcMain.handle('preferences:was-freshly-created', (): boolean => preferencesWereFreshlyCreated)

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

ipcMain.on('agentSession:write', (_event, request: AgentSessionWriteRequest) => {
  if (!request || typeof request.sessionId !== 'string' || typeof request.data !== 'string') return
  getAgentSessionManager().write(request.sessionId, request.data)
})

ipcMain.on('agentSession:resize', (_event, request: AgentSessionResizeRequest) => {
  if (!request || typeof request.sessionId !== 'string') return
  getAgentSessionManager().resize(request.sessionId, request.cols, request.rows)
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

ipcMain.handle('agentSession:close', (_event, request: AgentSessionCloseRequest) => {
  if (!request || typeof request.sessionId !== 'string') return false
  return getAgentSessionManager().close(request.sessionId)
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

  agentSessionManager?.closeAll()
}

void app.whenReady().then(async () => {
  shellRegistry = detectShells()
  const preferencesPath = path.join(app.getPath('userData'), 'preferences.json')
  preferencesStore = createPreferencesStore(preferencesPath)
  preferencesWereFreshlyCreated = !(await preferencesStore.exists())

  agentSessionManager = new AgentSessionManager({
    spawn: (file, args, options) => pty.spawn(file, args, options),
    resolveEffectiveShellId,
    resolveWorkspaceCwd,
    shellRegistry,
    platform: process.platform,
    env: process.env,
    onData: ({ sessionId, data }) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('agentSession:data', { sessionId, data })
      }
    },
    onExit: ({ sessionId, exitCode, signal }) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('agentSession:exit', { sessionId, exitCode, signal })
      }
    },
  })

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
