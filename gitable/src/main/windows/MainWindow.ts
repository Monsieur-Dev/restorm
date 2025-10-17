import { join } from 'path'
import { BaseWindow, WindowConfiguration, logger } from 'electron-vscodelike-core-ui'

/**
 * MainWindow - Main application window
 */
export class MainWindow extends BaseWindow {
  constructor() {
    logger.info('🏗️ MainWindow constructor started')
    
    // Create configuration object
    const configuration: WindowConfiguration = {
      name: 'main',
      defaultWidth: 1200,
      defaultHeight: 800,
      url: process.env['ELECTRON_RENDERER_URL'],
      file: join(__dirname, '../renderer/index.html'),
      preloadScript: join(__dirname, '../preload/index.js')
    }
    
    logger.info(`📋 Configuration: ${JSON.stringify(configuration, null, 2)}`)
    logger.info('🔧 Calling super() with configuration...')
    super(configuration)
    logger.info('✅ MainWindow constructor completed')
  }
}

