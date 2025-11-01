const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    frame: false,
    //titleBarStyle: 'hidden',
    /*titleBarOverlay:
      process.platform === 'win32' || process.platform === 'darwin'
        ? { color: '#2b2b2b', symbolColor: '#fff', height: 32 }
        : false,*/
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Charger depuis Vite en développement ou fichier local en production
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile('index.html');
  }

  // Envoyer la plateforme au front
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('platform', process.platform);
  });

  // Réception des actions depuis le renderer
  ipcMain.on('window-action', (event, action) => {
    switch (action) {
      case 'minimize':
        mainWindow.minimize();
        break;
      case 'maximize':
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();

        break;
      case 'close':
        mainWindow.close();
        break;
    }
  });

  // Envoyer l'état initial de la fenêtre
  mainWindow.webContents.send('window-state', mainWindow.isMaximized() ? 'maximized' : 'normal');

  // Écouter les changements d'état de la fenêtre (double-clic sur la barre de titre, etc.)
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', 'maximized'));

  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', 'normal'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
