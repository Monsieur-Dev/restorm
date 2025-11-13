import { app, ipcMain, BrowserWindow } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { EditorWindow } from './windows/EditorWindow'
import { initializeApp, logger } from 'electron-vscodelike-core-ui'
import { join } from 'path'

function createWindow(): void {
  logger.info('🪟 Creating main window...')
  try {
    // Create main window (instance is stored in WindowManager singleton)
    new MainWindow()
    logger.info('✅ Main window created successfully')
  } catch (error) {
    logger.error('❌ Failed to create main window:', { error: String(error) })
    throw error
  }
}

// Get resources path from the core-ui package
function getResourcesPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  return isDev
    ? join(__dirname, '../../node_modules/electron-vscodelike-core-ui/resources')
    : join(process.resourcesPath, 'resources')
}

// Initialize Electron application
const resourcesPath = getResourcesPath()
initializeApp('Gitable', createWindow, resourcesPath)

// Store file parameters for Editor window (keyed by window ID)
const editorWindowFiles = new Map<number, { title: string; content?: string }>()

// IPC handler to open Editor window
ipcMain.handle('gitable:open-editor', (_event, file?: { title: string; content?: string; x?: number; y?: number }) => {
  logger.info('📝 Opening Editor window...', { file })
  try {
    const editorWindow = new EditorWindow(file)
    // Wait a bit for window to be fully created, then store file parameters
    setTimeout(() => {
      const window = editorWindow.getWindow()
      if (window && file) {
        // Store file parameters with window ID as key (without x, y which are used for positioning)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { x: _x, y: _y, ...fileParams } = file
        editorWindowFiles.set(window.id, fileParams)
        logger.info('📦 Stored file parameters for window', { windowId: window.id, file: fileParams })
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
ipcMain.handle('gitable:get-editor-file', (event) => {
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

// IPC handler to close window (duplicate from IPCManager to ensure it's always available)
// This handler is also registered in IPCManager.setupIPC, but we register it here
// as a fallback to ensure it's available even if setupIPC hasn't run yet
ipcMain.handle('close-window', (event) => {
  const wnd = BrowserWindow.fromWebContents(event.sender)
  if (wnd && !wnd.isDestroyed()) {
    logger.info('Closing window', { windowId: wnd.id })
    wnd.close()
  }
})

// IPC handler to send workbench tab to window (duplicate from IPCManager to ensure it's always available)
// This handler is also registered in IPCManager.setupIPC, but we register it here
// as a fallback to ensure it's available even if setupIPC hasn't run yet
ipcMain.handle('tabs:send-workbench-tab-to-window', (_event, targetWindowId: number, tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => {
  // Get all windows to debug
  const allWindows = BrowserWindow.getAllWindows()
  logger.info('Attempting to send tab to window', { 
    targetWindowId, 
    allWindowIds: allWindows.map(win => ({ id: win.id, webContentsId: win.webContents.id, destroyed: win.isDestroyed() }))
  })
  
  const targetWindow = BrowserWindow.fromId(targetWindowId)
  if (!targetWindow || targetWindow.isDestroyed()) {
    logger.warn('Target window not found for cross-window tab drag', { 
      targetWindowId,
      allWindowIds: allWindows.map(win => win.id),
      allWebContentsIds: allWindows.map(win => win.webContents.id)
    })
    return false
  }
  
  // Send tab data to target window
  targetWindow.webContents.send('tabs:workbench-tab-dropped', tabData)
  logger.info('Tab data sent to target window', { targetWindowId, tabId: tabData.tabId, cursorX: tabData.cursorX, cursorY: tabData.cursorY })
  return true
})

