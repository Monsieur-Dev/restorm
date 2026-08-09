/**
 * TypeScript Decorators for Document Management
 *
 * Generic decorators that can be used to configure:
 * - Tracking (change detection)
 * - Search indexing
 * - Serialization behavior
 * - Save-unit boundaries (per-unit dirty state / drafts)
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

// @TreatEmptyAsUndefined
export {
  TreatEmptyAsUndefined,
  isTreatedEmptyAsUndefined,
  getTreatEmptyAsUndefinedProperties,
  normalizeTreatEmptyAsUndefined
} from './treatEmptyAsUndefined'

// @saveUnits
export { saveUnits, hasSaveUnits, getSaveUnitsConfig, getSaveUnitsProperties } from './saveUnits'
export type { SaveUnitsConfig } from './saveUnits'

// @fileNaming
export { fileNaming, getFileNamingConfig, generateFileName } from './fileNaming'
export type { FileNamingConfig } from './fileNaming'

// @graphqlField
export { graphqlType, graphqlField, isGraphQLField, getGraphQLTypeConfig, getGraphQLFieldConfig, getGraphQLFields } from './graphqlField'
export type { GraphQLTypeConfig, GraphQLFieldConfig } from './graphqlField'

// Utilities
export { getAllMetadata, serializeWithDecorators } from './utils'
export type { AllMetadata } from './utils'
