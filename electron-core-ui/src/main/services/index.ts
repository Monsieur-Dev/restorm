// Export services explicitly for better type inference
export { logger } from './LoggerService'
export type { LoggerInterface } from './LoggerService'

export { getStorageService, StorageService } from './StorageService'

export { getThemeService, ThemeService } from './ThemeService'

export {
  initFeatureService,
  getFeatureService,
  isFeatureServiceInitialized,
  FeatureFlippingService
} from './FeatureFlippingService'

export {
  initFileService,
  getFileService,
  isFileServiceInitialized,
  FileService
} from './FileService'

export { eventBusService } from './EventBusService'
export type { EventHandler, Subscription } from './EventBusService'

export { i18nService } from './I18nService'

export { searchService } from './SearchService'
export type {
  SearchDocument,
  SearchResult,
  SearchNavigation,
  GroupedResults,
  CategoryMeta
} from './SearchService'
