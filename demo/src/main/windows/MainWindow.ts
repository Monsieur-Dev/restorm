import { join } from 'path'
import { logger } from 'electron-core-ui'
import { DemoWindow } from './DemoWindow'

/**
 * MainWindow - Main application window
 */
export class MainWindow extends DemoWindow {
  constructor() {
    logger.info('🏗️ MainWindow constructor started')
    
    // Create configuration object using DemoWindow static helper
    const configuration = DemoWindow.createConfiguration({
      name: 'main',
      defaultWidth: 1200,
      defaultHeight: 800,
      url: process.env['ELECTRON_RENDERER_URL'],
      file: join(__dirname, '../renderer/index.html'),
      iconPath: join(__dirname, '../../assets/icons/icon')
    })
    
    logger.info(`📋 Configuration: ${JSON.stringify(configuration, null, 2)}`)
    logger.info('🔧 Calling super() with configuration...')
    super(configuration)
    logger.info('✅ MainWindow constructor completed')
  }
}

  