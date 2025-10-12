import { join } from 'path'
import { BaseWindow } from './_BaseWindow'

/**
 * MainWindow - Main application window
 */
export class MainWindow extends BaseWindow {
  constructor() {
    super({
      name: 'main',
      defaultWidth: 1200,
      defaultHeight: 800,
      url: process.env['ELECTRON_RENDERER_URL'],
      file: join(__dirname, '../renderer/index.html')
    })
  }
}

