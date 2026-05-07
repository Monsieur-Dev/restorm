import React, { useState } from 'react'
import type { ModelDocumentation } from '../../../../shared/types/apiDocumentation'

export interface EnumsSectionProps {
  /** Models surfaced by the host. We walk their properties and
   * collect every property carrying `enumValues`. */
  models: ModelDocumentation[]
}

interface EnumGroup {
  modelName: string
  entries: { propertyName: string; values: string[] }[]
}

const SEE_MORE_THRESHOLD = 20

function formatEnumValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/**
 * Lists every enum declared inside the surfaced models, grouped by
 * model name. Hidden when no enum is present. For enums longer than
 * `SEE_MORE_THRESHOLD` values, the list collapses to the first N
 * with a "see more" toggle to keep large generated enums (country
 * codes, currency lists, …) from blowing up the page.
 */
export const EnumsSection: React.FC<EnumsSectionProps> = ({ models }) => {
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

  if (groups.length === 0) return null

  return (
    <section
      className="documentation-host-enums"
      data-testid="documentation-host-enums-section"
    >
      <h1 className="documentation-host__section-title">Enums</h1>
      <div className="documentation-host-enums__list">
        {groups.map((group) => (
          <div
            key={group.modelName}
            className="documentation-host-enums__model"
            data-testid={`documentation-host-enums-model-${group.modelName}`}
          >
            <h3 className="documentation-host-enums__model-name">{group.modelName}</h3>
            <dl className="documentation-host-enums__entries">
              {group.entries.map((entry) => (
                <EnumEntry
                  key={entry.propertyName}
                  modelName={group.modelName}
                  propertyName={entry.propertyName}
                  values={entry.values}
                />
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  )
}

interface EnumEntryProps {
  modelName: string
  propertyName: string
  values: string[]
}

const EnumEntry: React.FC<EnumEntryProps> = ({ modelName, propertyName, values }) => {
  const [expanded, setExpanded] = useState(false)
  const truncated = values.length > SEE_MORE_THRESHOLD
  const visible = truncated && !expanded ? values.slice(0, SEE_MORE_THRESHOLD) : values
  return (
    <>
      <dt className="documentation-host-enums__property">
        <code>{propertyName}</code>
      </dt>
      <dd
        className="documentation-host-enums__values"
        data-testid={`documentation-host-enums-${modelName}-${propertyName}`}
      >
        {visible.map((v, i) => (
          <code key={`${v}-${String(i)}`} className="documentation-host-enums__value">
            {v}
          </code>
        ))}
        {truncated && (
          <button
            type="button"
            className="documentation-host-enums__see-more"
            onClick={(): void => { setExpanded(!expanded) }}
          >
            {expanded
              ? 'see less'
              : `see more (${String(values.length - SEE_MORE_THRESHOLD)} more)`}
          </button>
        )}
      </dd>
    </>
  )
}
