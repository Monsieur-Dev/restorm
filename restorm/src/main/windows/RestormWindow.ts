import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import { BaseWindow, WindowConfiguration, logger } from 'electron-core-ui'

/**
 * RestormWindow - Base class for all restorm windows
 * Contains common logic for determining preload path
 */
export class RestormWindow extends BaseWindow {
  /** Memoised preload path — the filesystem layout is fixed for the process
   * lifetime, so resolve it once instead of re-running ~6 existsSync probes on
   * every window creation. `false` = not yet resolved (the value can be
   * `undefined`, which is a valid resolved result). */
  private static preloadPathCache: string | undefined | false = false

  /**
   * Determines the preload script path based on environment
   * Always uses restorm preload which includes all core-ui APIs + restorm-specific APIs
   * In dev, tries to use restorm preload if it exists, otherwise uses core-ui preload from node_modules
   * In prod, uses restorm preload from dist
   */
  protected static getPreloadPath(): string | undefined {
    if (RestormWindow.preloadPathCache !== false) return RestormWindow.preloadPathCache
    const isDev = !app.isPackaged
    let preloadPath: string | undefined

    if (isDev) {
      // In dev, try to use restorm preload from out/ or dist/ (build) first
      // This ensures window.restorm is always available
      const appRoot = app.getAppPath()
      // __dirname is dist/main, so go up 2 levels to get restorm project root
      const projectRoot = join(__dirname, '../..')
      
      // Priority order: out/ (electron-vite default), then dist/, then dev
      const paths = [
        join(projectRoot, 'out', 'preload', 'index.js'),
        join(__dirname, '../preload/index.js'),
        join(projectRoot, 'dist', 'preload', 'index.js'),
        join(appRoot, 'out', 'preload', 'index.js'),
        join(appRoot, 'dist', 'preload', 'index.js'),
        join(appRoot, '.electron-vite', 'dev', 'preload', 'index.mjs')
      ]
      
      for (const p of paths) {
        if (existsSync(p)) {
          preloadPath = p
          break
        }
      }
      
      if (!preloadPath) {
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
    
    RestormWindow.preloadPathCache = preloadPath
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
