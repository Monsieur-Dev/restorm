import { app, BrowserWindow } from 'electron'
import { MainWindow } from './windows/MainWindow'

// Disable sandbox and GPU acceleration for restricted environments (WSL, containers, etc.)
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-dev-shm-usage')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-gpu-compositing')

let _mainWindow: MainWindow | null = null

function createWindow(): void {
  _mainWindow = new MainWindow()
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((error) => {
  console.error('App failed to start:', error)
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

