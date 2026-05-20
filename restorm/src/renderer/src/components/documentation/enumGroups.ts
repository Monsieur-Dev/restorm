import type { ModelDocumentation } from '../../../../shared/types/apiDocumentation'

export interface EnumGroup {
  modelName: string
  /** Property-level enums: each property of an object model that
   * carries an `enum`. Empty for a top-level enum schema. */
  entries: { propertyName: string; values: string[] }[]
  /** Values declared at the schema's top level (a `$ref`-able enum
   * schema like `{ type: "string", enum: [...] }`). Present only for
   * enum-typed models, which carry no properties. */
  modelLevelValues?: string[]
}

function formatEnumValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/** A schema that is itself an enumeration (`{ type: "string", enum:
 * [...] }`) rather than an object — it carries `enumValues` and has
 * no properties. These render in the Enums section + sidebar, never
 * as model-graph nodes. */
export function isEnumModel(model: ModelDocumentation): boolean {
  return Array.isArray(model.enumValues) && model.enumValues.length > 0 && model.properties.length === 0
}

/** Walk the surfaced models and bucket every enum under its model.
 * Object models contribute one entry per property carrying
 * `enumValues`; a top-level enum schema contributes its values
 * directly via `modelLevelValues`. Shared between the rendered Enums
 * section and the sidebar outline so they stay in sync. */
export function collectEnumGroups(models: ModelDocumentation[]): EnumGroup[] {
  const groups: EnumGroup[] = []
  for (const model of models) {
    if (isEnumModel(model)) {
      groups.push({
        modelName: model.name,
        entries: [],
        modelLevelValues: (model.enumValues ?? []).map(formatEnumValue)
      })
      continue
    }
    const entries: EnumGroup['entries'] = []
    for (const prop of model.properties) {
      if (prop.enumValues && prop.enumValues.length > 0) {
        entries.push({
          propertyName: prop.name,
          values: prop.enumValues.map(formatEnumValue)
        })
      }
    }
    if (entries.length > 0) groups.push({ modelName: model.name, entries })
  }
  return groups
}
