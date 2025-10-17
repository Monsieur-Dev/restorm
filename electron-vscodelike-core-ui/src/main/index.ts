// Main process exports - with proper TypeScript types
export { getThemeService, getStorageService, logger } from './services'
export { BaseWindow } from './managers'
export type { WindowConfiguration, WindowState } from './managers'

// Re-export types for better type inference
export type { ThemeService } from './services/ThemeService'
export type { StorageService } from './services/StorageService'
export type { LoggerInterface } from './services/LoggerService'

