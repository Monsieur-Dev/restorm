// Re-export from `shared` so both renderer and main process share one
// implementation. Kept at this path to avoid churning the many renderer imports.
export { mergeEnumDefinitionsIntoModels } from '../../../../shared/design/mergeEnumDefinitions'
