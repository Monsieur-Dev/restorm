import type { ApiDocumentation, ModelDocumentation } from '../types/apiDocumentation'
import type { EnumDefinition } from '../types/baseTypes'

/**
 * Returns a new ApiDocumentation whose `models[name]` carries
 * `enumValues` populated from the matching `enumDefinitions[name]`
 * entry on the owning EnvironmentFolder.
 *
 * Background: pre-existing imports stored the enum values on a
 * sibling `EnvironmentFolder.enumDefinitions` array rather than on
 * the `ApiDocumentation.models.<name>.enumValues` field. New
 * imports (post fix) populate both. To stay backwards-compatible
 * with the still-loaded sessions and avoid forcing the user to
 * re-import, we merge the env-folder list into the model docs
 * whenever the model entry is missing `enumValues` but a matching
 * definition exists.
 *
 * Returns the original `apiDoc` reference when nothing needs to
 * change — preserves referential equality for downstream memos.
 *
 * Lives in `shared` because both the renderer (documentation views,
 * search) and the main process (background design validation) project
 * the same documentation and must see the same merged enums.
 */
export function mergeEnumDefinitionsIntoModels(
  apiDoc: ApiDocumentation,
  enumDefinitions: readonly EnumDefinition[] | undefined
): ApiDocumentation {
  if (!enumDefinitions || enumDefinitions.length === 0) return apiDoc

  const byName = new Map<string, EnumDefinition>()
  for (const def of enumDefinitions) byName.set(def.name, def)

  let mutated = false
  const nextModels: Record<string, ModelDocumentation> = {}
  for (const [name, model] of Object.entries(apiDoc.models)) {
    if (model.enumValues !== undefined && model.enumValues.length > 0) {
      nextModels[name] = model
      continue
    }
    if (model.properties.length > 0) {
      // Object model with properties is never an enum — leave it
      // alone even if a same-named EnumDefinition exists.
      nextModels[name] = model
      continue
    }
    const def = byName.get(name)
    if (!def || def.values.length === 0) {
      nextModels[name] = model
      continue
    }
    nextModels[name] = { ...model, enumValues: [...def.values] }
    mutated = true
  }
  if (!mutated) return apiDoc
  return { ...apiDoc, models: nextModels }
}
