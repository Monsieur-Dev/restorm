/**
 * TypeScript Decorators for Document Management
 *
 * Generic decorators that can be used to configure:
 * - Tracking (change detection)
 * - Search indexing
 * - Serialization behavior
 * - File structure (separate files/folders)
 * - File naming patterns
 *
 * These decorators are generic and contain no application-specific logic.
 */

// Metadata storage (internal)
export { METADATA_KEYS } from './metadata'

// @trackable
export { trackable, isTrackable, getTrackableConfig, getTrackableProperties } from './trackable'
export type { TrackableConfig } from './trackable'

// @searchable
export { searchable, isSearchable, getSearchableConfig, getSearchableProperties } from './searchable'
export type { SearchableConfig } from './searchable'

// @NonSerialised
export { NonSerialised, isNonSerialised, getNonSerialisedProperties } from './nonSerialised'

// @separateFiles
export { separateFiles, hasSeparateFiles, getSeparateFilesConfig, getSeparateFilesProperties } from './separateFiles'
export type { SeparateFilesConfig } from './separateFiles'

// @separateFolders
export { separateFolders, hasSeparateFolders, getSeparateFoldersConfig, getSeparateFoldersProperties } from './separateFolders'
export type { SeparateFoldersConfig } from './separateFolders'

// @fileNaming
export { fileNaming, getFileNamingConfig, generateFileName } from './fileNaming'
export type { FileNamingConfig } from './fileNaming'

// @graphqlField
export { graphqlType, graphqlField, isGraphQLField, getGraphQLTypeConfig, getGraphQLFieldConfig, getGraphQLFields } from './graphqlField'
export type { GraphQLTypeConfig, GraphQLFieldConfig } from './graphqlField'

// Utilities
export { getAllMetadata, serializeWithDecorators } from './utils'
export type { AllMetadata } from './utils'
