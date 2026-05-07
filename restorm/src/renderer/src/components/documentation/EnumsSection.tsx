import React, { forwardRef, useState } from 'react'
import type { ModelDocumentation } from '../../../../shared/types/apiDocumentation'
import { collectEnumGroups } from './enumGroups'

export interface EnumsSectionProps {
  /** Models surfaced by the host. We walk their properties and
   * collect every property carrying `enumValues`. */
  models: ModelDocumentation[]
  /** Heading level for the "Enums" title. H1 in single-route scope
   * (peer of the route summary), H2 in folder / env-folder scope
   * (sibling of the scope H1 + per-tag group H2). */
  headingLevel?: 1 | 2
}

const SEE_MORE_THRESHOLD = 20

/**
 * Lists every enum declared inside the surfaced models, grouped by
 * model name. Hidden when no enum is present. For enums longer than
 * `SEE_MORE_THRESHOLD` values, the list collapses to the first N
 * with a "see more" toggle to keep large generated enums (country
 * codes, currency lists, …) from blowing up the page.
 */
export const EnumsSection = forwardRef<HTMLElement, EnumsSectionProps>(({ models, headingLevel = 1 }, ref) => {
  const groups = collectEnumGroups(models)

  if (groups.length === 0) return null

  return (
    <section
      ref={ref}
      className="documentation-host-enums"
      data-testid="documentation-host-enums-section"
    >
      {headingLevel === 1
        ? <h1 className="documentation-host__section-title">Enums</h1>
        : <h2 className="documentation-host__section-title">Enums</h2>}
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
})
EnumsSection.displayName = 'EnumsSection'

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
