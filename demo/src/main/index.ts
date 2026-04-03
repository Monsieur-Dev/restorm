import { app, ipcMain, BrowserWindow } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { EditorWindow } from './windows/EditorWindow'
import { initializeApp, logger } from 'electron-core-ui'
import { join, relative } from 'path'
import { existsSync } from 'fs'
import { promises as fs } from 'fs'

function createWindow(): void {
  const startTime = performance.now()
  logger.info('🪟 Creating main window...')
  try {
    // Create main window (instance is stored in WindowManager singleton)
    new MainWindow()
    logger.info(`✅ Main window created successfully in ${(performance.now() - startTime).toFixed(2)}ms`)
  } catch (error) {
    logger.error('❌ Failed to create main window:', { error: String(error) })
    throw error
  }
}

// Get resources path from the core-ui package
function getResourcesPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    // In development, point directly to the monorepo's electron-core-ui resources
    // so that changes to YAML/JSON themes are picked up without reinstalling.
    const appPath = app.getAppPath()
    return join(appPath, '../electron-core-ui/resources')
  }

  // In production, resources are bundled under process.resourcesPath/resources
  return join(process.resourcesPath, 'resources')
}

// Get settings configuration path for demo
function getSettingsConfigPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    const appPath = app.getAppPath()
    return join(appPath, 'resources/settings.yaml')
  }
  return join(process.resourcesPath, 'demo-resources/settings.yaml')
}

// Initialize Electron application
const resourcesPath = getResourcesPath()
const settingsConfigPath = getSettingsConfigPath()
initializeApp('Demo', createWindow, resourcesPath, undefined, undefined, existsSync(settingsConfigPath) ? settingsConfigPath : undefined)

// Store file parameters for Editor window (keyed by window ID)
const editorWindowFiles = new Map<number, { title: string; content?: string }>()

// IPC handler to open Editor window
ipcMain.handle('demo:open-editor', (_event, file?: { title: string; content?: string; x?: number; y?: number }) => {
  logger.info('📝 Opening Editor window...', { file })
  try {
    const editorWindow = new EditorWindow(file)
    // Wait a bit for window to be fully created, then store file parameters
    setTimeout(() => {
      const window = editorWindow.getWindow()
      if (window && file) {
        // Store file parameters with window ID as key (without x, y which are used for positioning)
        const { x, y, ...fileParams } = file
        editorWindowFiles.set(window.id, fileParams)
        logger.info('📦 Stored file parameters for window', { windowId: window.id, file: fileParams, x, y })
      } else {
        logger.warn('⚠️ Window not available or no file provided', { hasWindow: !!window, hasFile: !!file })
      }
    }, 100)
    logger.info('✅ Editor window created successfully')
  } catch (error) {
    logger.error('❌ Failed to create Editor window:', { error: String(error) })
    throw error
  }
})

// IPC handler to get file parameters for Editor window
ipcMain.handle('demo:get-editor-file', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) {
    logger.warn('⚠️ Window not found for get-editor-file')
    return undefined
  }
  const file = editorWindowFiles.get(window.id)
  if (file) {
    logger.info('📤 Returning file parameters for window', { windowId: window.id, file })
    // Clean up after sending
    editorWindowFiles.delete(window.id)
  } else {
    logger.warn('⚠️ No file parameters found for window', { windowId: window.id })
  }
  return file
})

// IPC handler to list project files from the Demo workspace root
ipcMain.handle('project:list-files', async () => {
  const projectRoot = join(__dirname, '../..')

  const results: { path: string; isDirectory: boolean }[] = []

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue
      }
      const fullPath = join(dir, entry.name)
      const relPath = relative(projectRoot, fullPath)
      const isDirectory = entry.isDirectory()
      results.push({ path: relPath, isDirectory })
      if (isDirectory) {
        await walk(fullPath)
      }
    }
  }

  try {
    await walk(projectRoot)
    return results
  } catch (error) {
    logger.error('Failed to list project files', { error: String(error) })
    return []
  }
})

// IPC handler to read a project file (relative to the Demo workspace root)
ipcMain.handle('project:read-file', async (_event, relPath: string) => {
  const projectRoot = join(__dirname, '../..')
  const safePath = join(projectRoot, relPath)

  // Basic safety: ensure resolved path stays under project root
  if (!safePath.startsWith(projectRoot)) {
    logger.warn('Blocked attempt to read file outside project root', { relPath })
    return ''
  }

  try {
    const content = await fs.readFile(safePath, 'utf8')
    return content
  } catch (error) {
    logger.error('Failed to read project file', { relPath, error: String(error) })
    return ''
  }
})
