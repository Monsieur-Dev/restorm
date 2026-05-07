import type { ModelDocumentation } from '../../../../shared/types/apiDocumentation'

export interface EnumGroup {
  modelName: string
  entries: { propertyName: string; values: string[] }[]
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

/** Walk the surfaced models and bucket every property carrying
 * `enumValues` under its model. Shared between the rendered Enums
 * section and the sidebar outline so they stay in sync. */
export function collectEnumGroups(models: ModelDocumentation[]): EnumGroup[] {
  const groups: EnumGroup[] = []
  for (const model of models) {
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
