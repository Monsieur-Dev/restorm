import { join } from 'path'
import type { BrowserWindowConstructorOptions } from 'electron'
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

  /**
   * Enable the `<webview>` tag for the Mini browser. The Mini browser
   * needs to embed arbitrary third-party origins (e.g. play.artifactsmmo.com)
   * and let those pages use their own localStorage / IndexedDB / cookies.
   * A plain `<iframe>` in restorm's renderer is a *cross-site* third-party
   * context for those origins, and Chrome 137+'s storage partitioning
   * silently blocks their `localStorage` access — login forms that store
   * JWTs in localStorage just stop working with no visible error.
   *
   * Electron `<webview>` is process-isolated with its own top-level
   * browsing context, so the embedded page behaves like a real browser
   * tab and storage works normally. The flag is off by default in
   * Electron for safety, so we opt in here.
   */
  protected override createWindow(options: Partial<BrowserWindowConstructorOptions> = {}): void {
    super.createWindow({
      ...options,
      webPreferences: {
        ...(options.webPreferences ?? {}),
        webviewTag: true
      }
    })
  }
}
