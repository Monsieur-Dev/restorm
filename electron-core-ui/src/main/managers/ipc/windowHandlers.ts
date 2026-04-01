import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { validatedHandle } from '../../ipc/validate'
import { tabsCreateAuxWindowArgs, tabsSendToWindowArgs } from '../../ipc/schemas'
import { logger } from '../../services'

export function registerWindowHandlers(): void {
  // ========================================================================
  // Developer Tools IPC handler
  // ========================================================================
  ipcMain.handle('devtools:toggle', () => {
    const mainWindow = BrowserWindow.getFocusedWindow()
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools()
        logger.info('Developer Tools closed')
      } else {
        mainWindow.webContents.openDevTools()
        logger.info('Developer Tools opened')
      }
    }
  })

  // ========================================================================
  // Window control IPC handlers (no args, use event.sender)
  // ========================================================================
  ipcMain.handle('minimize-window', (event) => {
    const wnd = BrowserWindow.fromWebContents(event.sender)
    if (wnd && !wnd.isDestroyed()) {
      wnd.minimize()
      logger.info('Window minimized')
    }
  })

  ipcMain.handle('maximize-window', (event) => {
    const wnd = BrowserWindow.fromWebContents(event.sender)
    if (wnd && !wnd.isDestroyed()) {
      if (wnd.isMaximized()) {
        wnd.unmaximize()
        logger.info('Window unmaximized')
      } else {
        wnd.maximize()
        logger.info('Window maximized')
      }
    }
  })

  ipcMain.handle('close-window', (event) => {
    const wnd = BrowserWindow.fromWebContents(event.sender)
    if (wnd && !wnd.isDestroyed()) {
      logger.info('Closing window', { windowId: wnd.id })
      wnd.close()
    }
  })

  // ========================================================================
  // Tabs: helpers for aux windows and pointer position
  // ========================================================================
  ipcMain.handle('tabs:get-cursor-screen-point', () => {
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    return { x: point.x, y: point.y, display: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height } };
  });

  ipcMain.handle('tabs:get-active-window-bounds', () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const bounds = win.getBounds();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });

  ipcMain.handle('tabs:get-current-window-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      return { x: 0, y: 0, width: 0, height: 0, windowId: -1 };
    }
    const bounds = win.getBounds();
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      windowId: win.id
    };
  });

  validatedHandle('tabs:create-aux-window', tabsCreateAuxWindowArgs, (_event, [payload, bounds]) => {
    const win = new BrowserWindow({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: bounds.width ?? 900,
      height: bounds.height ?? 600,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js')
      },
      show: true,
      title: payload.title
    });
    const first = BrowserWindow.getAllWindows()[0];
    const urlToLoad = first?.webContents.getURL();
    if (urlToLoad && urlToLoad.length > 0) {
      win.loadURL(urlToLoad).catch((err: unknown) => { logger.error('Failed to load URL in aux window', { error: String(err) }); });
    }
  });

  ipcMain.handle('tabs:get-window-under-cursor', () => {
    const point = screen.getCursorScreenPoint();
    const windows = BrowserWindow.getAllWindows();

    logger.info('Finding window under cursor', {
      cursorPoint: { x: point.x, y: point.y },
      windowCount: windows.length,
      windows: windows.map(win => ({
        id: win.id,
        webContentsId: win.webContents.id,
        destroyed: win.isDestroyed(),
        bounds: win.getBounds()
      }))
    })

    for (const win of windows) {
      if (win.isDestroyed()) continue;
      const bounds = win.getBounds();
      if (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height
      ) {
        if (!win.id) {
          logger.warn('Window ID is undefined', { webContentsId: win.webContents.id })
          continue
        }

        logger.info('Found window under cursor', {
          windowId: win.id,
          webContentsId: win.webContents.id,
          bounds
        })

        return {
          windowId: win.id,
          bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }
        }
      }
    }

    logger.warn('No window found under cursor', { cursorPoint: { x: point.x, y: point.y } })
    return null
  });

  validatedHandle('tabs:send-workbench-tab-to-window', tabsSendToWindowArgs, (_event, [targetWindowId, tabData]) => {
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

    targetWindow.webContents.send('tabs:workbench-tab-dropped', tabData)
    logger.info('Tab data sent to target window', { targetWindowId, tabId: tabData.tabId, cursorX: tabData.cursorX, cursorY: tabData.cursorY })
    return true
  });
}
