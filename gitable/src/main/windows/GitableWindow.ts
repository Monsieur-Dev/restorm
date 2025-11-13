import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import { BaseWindow, WindowConfiguration, logger } from 'electron-vscodelike-core-ui'

/**
 * GitableWindow - Base class for all Gitable windows
 * Contains common logic for determining preload path
 */
export class GitableWindow extends BaseWindow {
  /**
   * Determines the preload script path based on environment
   * Always uses gitable preload which includes all core-ui APIs + gitable-specific APIs
   * In dev, tries to use gitable preload if it exists, otherwise uses core-ui preload from node_modules
   * In prod, uses gitable preload from dist
   */
  protected static getPreloadPath(): string | undefined {
    const isDev = !app.isPackaged
    let preloadPath: string | undefined
    
    if (isDev) {
      // In dev, try to use gitable preload from out/ (build prod) first
      // This ensures window.gitable is always available
      // Try multiple paths: dev build, prod build, or node_modules
      const appRoot = app.getAppPath()
      const projectRoot = join(__dirname, '../../..') // Go up from dist/main/windows to project root
      
      const devPreloadPath = join(appRoot, '.electron-vite', 'dev', 'preload', 'index.mjs')
      const prodPreloadPath1 = join(appRoot, 'out', 'preload', 'index.js')
      const prodPreloadPath2 = join(projectRoot, 'out', 'preload', 'index.js')
      
      if (existsSync(devPreloadPath)) {
        preloadPath = devPreloadPath
        logger.info(`📋 Using gitable preload (dev): ${preloadPath}`)
      } else if (existsSync(prodPreloadPath2)) {
        preloadPath = prodPreloadPath2
        logger.info(`📋 Using gitable preload (prod build in dev): ${preloadPath}`)
      } else if (existsSync(prodPreloadPath1)) {
        preloadPath = prodPreloadPath1
        logger.info(`📋 Using gitable preload (prod build in dev from appRoot): ${preloadPath}`)
      } else {
        // Fallback to core-ui preload from node_modules
        const coreUiPreloadPath = join(appRoot, 'node_modules', 'electron-vscodelike-core-ui', 'dist', 'src', 'preload', 'index.js')
        if (existsSync(coreUiPreloadPath)) {
          preloadPath = coreUiPreloadPath
          logger.info(`📋 Using core-ui preload from node_modules: ${preloadPath}`)
          logger.warn('⚠️ window.gitable will not be available (core-ui preload does not expose it)')
        } else {
          // Last resort: let BaseWindow use its default (may not work in dev)
          logger.warn('⚠️ Neither gitable nor core-ui preload found, using BaseWindow default')
          preloadPath = undefined
        }
      }
    } else {
      // In prod, use gitable preload
      preloadPath = join(__dirname, '../preload/index.js')
      if (existsSync(preloadPath)) {
        logger.info(`📋 Using gitable preload: ${preloadPath}`)
      } else {
        logger.warn(`⚠️ Gitable preload not found: ${preloadPath}, using BaseWindow default`)
        preloadPath = undefined
      }
    }
    
    return preloadPath
  }

  /**
   * Creates a window configuration with the preload script path determined automatically
   */
  protected static createConfiguration(config: Omit<WindowConfiguration, 'preloadScript'>): WindowConfiguration {
    const preloadPath = GitableWindow.getPreloadPath()
    return {
      ...config,
      ...(preloadPath && { preloadScript: preloadPath })
    }
  }
}

