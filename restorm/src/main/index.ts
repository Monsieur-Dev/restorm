import { app } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { initializeApp, logger } from 'electron-core-ui'
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
  if (isDev) {
    // In development, point directly to the monorepo's electron-core-ui resources
    // so that changes to YAML/JSON themes are picked up without reinstalling.
    const appPath = app.getAppPath()
    return join(appPath, '../electron-core-ui/resources')
  }

  // In production, resources are bundled under process.resourcesPath/resources
  return join(process.resourcesPath, 'resources')
}

// Initialize Electron application
const resourcesPath = getResourcesPath()
initializeApp('restorm', createWindow, resourcesPath)
