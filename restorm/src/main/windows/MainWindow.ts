import { join } from 'path'
import { RestormWindow } from './RestormWindow'

/**
 * MainWindow - Main application window
 */
export class MainWindow extends RestormWindow {
  constructor() {
    // Create configuration object using restormWindow static helper
    const configuration = RestormWindow.createConfiguration({
      name: 'main',
      defaultWidth: 1200,
      defaultHeight: 800,
      url: process.env['ELECTRON_RENDERER_URL'],
      file: join(__dirname, '../renderer/index.html'),
      iconPath: join(__dirname, '../../assets/icons/icon')
    })
    super(configuration)
  }
}

  