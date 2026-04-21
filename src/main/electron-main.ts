import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type {
  TerminalAttachRequest,
  TerminalAttachResponse,
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalListShellsResponse,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from '../shared/terminal-types'
import type { AppPreferences } from '../shared/preferences-types'
import type { ShellDescriptor } from '../shared/shell-registry'
import { detectPreferredShellId } from './shell-resolver'
import { detectShells } from './shell-detection'
import { createPreferencesStore, migratePreferences, type PreferencesStore } from './preferences'
import { createAppStateStore, type AppStateStore } from './app-state-store'
import { SessionHostClient } from './session-host-client'
import { getSessionHostEndpoint } from './session-host-path'

let mainWindow: BrowserWindow | null = null

let shellRegistry: ShellDescriptor[] = []
let preferencesStore: PreferencesStore | null = null
let appStateStore: AppStateStore | null = null
let preferencesWereFreshlyCreated = false
let sessionHostClient: SessionHostClient | null = null

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
      sandbox: false,
    },
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

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
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

async function createTerminal(request: TerminalCreateRequest): Promise<TerminalCreateResponse> {
  if (!sessionHostClient) throw new Error('Session host not initialised')
  const effectiveId = await resolveEffectiveShellId(request)
  return sessionHostClient.create({
    ...request,
    ...(effectiveId ? { shellId: effectiveId } : {}),
  })
}

async function attachTerminal(request: TerminalAttachRequest): Promise<TerminalAttachResponse> {
  if (!sessionHostClient) throw new Error('Session host not initialised')
  if (!request || typeof request.terminalId !== 'string' || request.terminalId.length === 0) {
    throw new Error('A valid terminalId is required')
  }
  return sessionHostClient.attach(request.terminalId)
}

export async function runElectronMain(): Promise<void> {
  ipcMain.handle('terminal:create', (_event, request: TerminalCreateRequest) => {
    return createTerminal(request)
  })

  ipcMain.handle('terminal:attach', (_event, request: TerminalAttachRequest) => {
    return attachTerminal(request)
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

  ipcMain.handle('app-state:get', async (): Promise<unknown | null> => {
    if (!appStateStore) throw new Error('App state store not initialised')
    return appStateStore.load()
  })

  ipcMain.handle('app-state:set', async (_event, next: unknown): Promise<unknown> => {
    if (!appStateStore) throw new Error('App state store not initialised')
    await appStateStore.save(next)
    return next
  })

  ipcMain.on('terminal:write', (_event, request: TerminalWriteRequest) => {
    if (!sessionHostClient) return
    if (!request || typeof request.terminalId !== 'string' || typeof request.data !== 'string') return
    if (request.data.length > 65536) return
    sessionHostClient.write(request.terminalId, request.data)
  })

  ipcMain.on('terminal:resize', (_event, request: TerminalResizeRequest) => {
    if (!sessionHostClient) return
    if (!request || typeof request.terminalId !== 'string') return
    sessionHostClient.resize(request.terminalId, request.cols, request.rows)
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

  ipcMain.handle('terminal:close', async (_event, request: TerminalCloseRequest) => {
    if (!sessionHostClient) return false
    if (!request || typeof request.terminalId !== 'string') return false
    return sessionHostClient.close(request.terminalId)
  })

  await app.whenReady()

  shellRegistry = detectShells()
  const userDataPath = app.getPath('userData')
  const preferencesPath = path.join(userDataPath, 'preferences.json')
  preferencesStore = createPreferencesStore(preferencesPath)
  preferencesWereFreshlyCreated = !(await preferencesStore.exists())
  appStateStore = createAppStateStore(path.join(userDataPath, 'app-state.json'))

  const sessionHostEntryPath = path.join(__dirname, 'index.js')
  sessionHostClient = new SessionHostClient({
    endpoint: getSessionHostEndpoint(userDataPath),
    entryScriptPath: sessionHostEntryPath,
  })

  sessionHostClient.onData((event) => {
    broadcast('terminal:data', event)
  })
  sessionHostClient.onExit((event) => {
    broadcast('terminal:exit', event)
  })

  await sessionHostClient.ensureConnected().catch((error) => {
    console.error('[baton-session-host]', error)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', () => {
    sessionHostClient?.dispose()
    sessionHostClient = null
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
