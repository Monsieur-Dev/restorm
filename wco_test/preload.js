const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onPlatform: (cb) => ipcRenderer.on('platform', (_, platform) => cb(platform)),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_, state) => cb(state)),
  sendAction: (action) => ipcRenderer.send('window-action', action)
});
