import { app } from 'electron'

/**
 * Window state interface
 */
export interface WindowState {
  width: number
  height: number
  x: number
  y: number
  fullscreen: boolean
}

/**
 * Complete window configuration interface
 */
export interface WindowConfiguration {
  name: string
  defaultWidth: number
  defaultHeight: number
  url: string | undefined
  file: string
  preloadScript?: string // Optional custom preload script path
  iconPath?: string // Optional icon path (without extension, auto-detected by platform)
  /**
   * When true the window is created hidden (`show: false`) and revealed
   * only once its renderer is ready to paint (`ready-to-show`), avoiding
   * the flash of an unstyled / half-loaded window. Used by the splash
   * handoff so the main window appears only when it's fully ready.
   */
  showWhenReady?: boolean
}

/**
 * Check if DevTools should be enabled
 * In development: always enabled
 * In production: disabled by default, can be enabled with --enable-dev-tools flag
 */
export function isDevToolsEnabled(): boolean {
  return !app.isPackaged || process.argv.includes('--enable-dev-tools')
}
