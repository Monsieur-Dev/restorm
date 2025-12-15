import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import { BaseWindow, WindowConfiguration, logger } from 'electron-core-ui'

/**
 * DemoWindow - Base class for all Demo windows
 * Contains common logic for determining preload path
 */
export class DemoWindow extends BaseWindow {
  /**
   * Determines the preload script path based on environment
   * Always uses demo preload which includes all core-ui APIs + demo-specific APIs
   * In dev, tries to use demo preload if it exists, otherwise uses core-ui preload from node_modules
   * In prod, uses demo preload from dist
   */
  protected static getPreloadPath(): string | undefined {
    const isDev = !app.isPackaged
    let preloadPath: string | undefined
    
    if (isDev) {
      // In dev, try to use demo preload from out/ (build prod) first
      // This ensures window.demo is always available
      // Try multiple paths: dev build, prod build, or node_modules
      const appRoot = app.getAppPath()
      const projectRoot = join(__dirname, '../../..') // Go up from dist/main/windows to project root
      
      const devPreloadPath = join(appRoot, '.electron-vite', 'dev', 'preload', 'index.mjs')
      const prodPreloadPath1 = join(appRoot, 'out', 'preload', 'index.js')
      const prodPreloadPath2 = join(projectRoot, 'out', 'preload', 'index.js')
      
      if (existsSync(devPreloadPath)) {
        preloadPath = devPreloadPath
        logger.info(`📋 Using demo preload (dev): ${preloadPath}`)
      } else if (existsSync(prodPreloadPath2)) {
        preloadPath = prodPreloadPath2
        logger.info(`📋 Using demo preload (prod build in dev): ${preloadPath}`)
      } else if (existsSync(prodPreloadPath1)) {
        preloadPath = prodPreloadPath1
        logger.info(`📋 Using demo preload (prod build in dev from appRoot): ${preloadPath}`)
      } else {
        // Fallback to core-ui preload from node_modules
        const coreUiPreloadPath = join(appRoot, 'node_modules', 'electron-core-ui', 'dist', 'src', 'preload', 'index.js')
        if (existsSync(coreUiPreloadPath)) {
          preloadPath = coreUiPreloadPath
          logger.info(`📋 Using core-ui preload from node_modules: ${preloadPath}`)
          logger.warn('⚠️ window.demo will not be available (core-ui preload does not expose it)')
        } else {
          // Last resort: let BaseWindow use its default (may not work in dev)
          logger.warn('⚠️ Neither demo nor core-ui preload found, using BaseWindow default')
          preloadPath = undefined
        }
      }
    } else {
      // In prod, use demo preload
      preloadPath = join(__dirname, '../preload/index.js')
      if (existsSync(preloadPath)) {
        logger.info(`📋 Using demo preload: ${preloadPath}`)
      } else {
        logger.warn(`⚠️ Demo preload not found: ${preloadPath}, using BaseWindow default`)
        preloadPath = undefined
      }
    }
    
    return preloadPath
  }

  /**
   * Creates a window configuration with the preload script path determined automatically
   */
  protected static createConfiguration(config: Omit<WindowConfiguration, 'preloadScript'>): WindowConfiguration {
    const preloadPath = DemoWindow.getPreloadPath()
    return {
      ...config,
      ...(preloadPath && { preloadScript: preloadPath })
    }
  }
}
