import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import { BaseWindow, WindowConfiguration, logger } from 'electron-core-ui'

/**
 * RestormWindow - Base class for all restorm windows
 * Contains common logic for determining preload path
 */
export class RestormWindow extends BaseWindow {
  /**
   * Determines the preload script path based on environment
   * Always uses restorm preload which includes all core-ui APIs + restorm-specific APIs
   * In dev, tries to use restorm preload if it exists, otherwise uses core-ui preload from node_modules
   * In prod, uses restorm preload from dist
   */
  protected static getPreloadPath(): string | undefined {
    const isDev = !app.isPackaged
    let preloadPath: string | undefined
    
    if (isDev) {
      // In dev, try to use restorm preload from out/ (build prod) first
      // This ensures window.restorm is always available
      // Try multiple paths: dev build, prod build, or node_modules
      const appRoot = app.getAppPath()
      const projectRoot = join(__dirname, '../../..') // Go up from dist/main/windows to project root
      
      const devPreloadPath = join(appRoot, '.electron-vite', 'dev', 'preload', 'index.mjs')
      const prodPreloadPath1 = join(appRoot, 'out', 'preload', 'index.js')
      const prodPreloadPath2 = join(projectRoot, 'out', 'preload', 'index.js')
      
      if (existsSync(devPreloadPath)) {
        preloadPath = devPreloadPath
      } else if (existsSync(prodPreloadPath2)) {
        preloadPath = prodPreloadPath2
      } else if (existsSync(prodPreloadPath1)) {
        preloadPath = prodPreloadPath1
      } else {
        // Fallback to core-ui preload from node_modules
        const coreUiPreloadPath = join(appRoot, 'node_modules', 'electron-core-ui', 'dist', 'src', 'preload', 'index.js')
        if (existsSync(coreUiPreloadPath)) {
          preloadPath = coreUiPreloadPath
          logger.warn('⚠️ window.restorm will not be available (core-ui preload does not expose it)')
        } else {
          // Last resort: let BaseWindow use its default (may not work in dev)
          logger.warn('⚠️ Neither restorm nor core-ui preload found, using BaseWindow default')
          preloadPath = undefined
        }
      }
    } else {
      // In prod, use restorm preload
      preloadPath = join(__dirname, '../preload/index.js')
      if (!existsSync(preloadPath)) {
        logger.warn(`⚠️ restorm preload not found: ${preloadPath}, using BaseWindow default`)
        preloadPath = undefined
      }
    }
    
    return preloadPath
  }

  /**
   * Creates a window configuration with the preload script path determined automatically
   */
  protected static createConfiguration(config: Omit<WindowConfiguration, 'preloadScript'>): WindowConfiguration {
    const preloadPath = RestormWindow.getPreloadPath()
    return {
      ...config,
      ...(preloadPath && { preloadScript: preloadPath })
    }
  }
}

