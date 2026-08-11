import React, { forwardRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import type { EnumGroup } from './enumGroups'

export interface EnumsSectionProps {
  /** Enum groups collected by the host — both property-level enums on
   * object models and top-level enum schemas. */
  enumGroups: EnumGroup[]
  /** Heading level for the "Enums" title. H1 in single-route scope
   * (peer of the route summary), H2 in folder / env-folder scope
   * (sibling of the scope H1 + per-tag group H2). */
  headingLevel?: 1 | 2
}

const SEE_MORE_THRESHOLD = 20

/**
 * Lists every enum surfaced by the host, grouped by model name —
 * property-level enums on object models plus standalone enum schemas
 * (which render their values directly under the schema name). Hidden
 * when no enum is present. For enums longer than `SEE_MORE_THRESHOLD`
 * values, the list collapses to the first N with a "see more" toggle
 * to keep large generated enums (country codes, currency lists, …)
 * from blowing up the page.
 */
export const EnumsSection = forwardRef<HTMLElement, EnumsSectionProps>(({ enumGroups, headingLevel = 1 }, ref) => {
  const { t } = useTranslation()
  if (enumGroups.length === 0) return null

  return (
    <section
      ref={ref}
      className="documentation-host-enums"
      data-testid="documentation-host-enums-section"
    >
      {headingLevel === 1
        ? <h1 className="documentation-host__section-title">{t('documentation.sections.enums')}</h1>
        : <h2 className="documentation-host__section-title">{t('documentation.sections.enums')}</h2>}
      <div className="documentation-host-enums__list">
        {enumGroups.map((group) => (
          <div
            key={group.modelName}
            className="documentation-host-enums__model"
            data-testid={`documentation-host-enums-model-${group.modelName}`}
          >
            <h3 className="documentation-host-enums__model-name">{group.modelName}</h3>
            {group.modelLevelValues !== undefined ? (
              <div
                className="documentation-host-enums__values"
                data-testid={`documentation-host-enums-${group.modelName}-`}
              >
                <EnumValues values={group.modelLevelValues} />
              </div>
            ) : (
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
            )}
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

const EnumEntry: React.FC<EnumEntryProps> = ({ modelName, propertyName, values }) => (
  <>
    <dt className="documentation-host-enums__property">
      <code>{propertyName}</code>
    </dt>
    <dd
      className="documentation-host-enums__values"
      data-testid={`documentation-host-enums-${modelName}-${propertyName}`}
    >
      <EnumValues values={values} />
    </dd>
  </>
)

const EnumValues: React.FC<{ values: string[] }> = ({ values }) => {
  const [expanded, setExpanded] = useState(false)
  const truncated = values.length > SEE_MORE_THRESHOLD
  const visible = truncated && !expanded ? values.slice(0, SEE_MORE_THRESHOLD) : values
  return (
    <>
      {visible.map((v, i) => (
        <code key={`${v}-${String(i)}`} className="documentation-host-enums__value">
          {v}
        </code>
      ))}
      {truncated && (
        <Button
          link
          className="documentation-host-enums__see-more"
          onClick={() => { setExpanded(!expanded) }}
        >
          {expanded
            ? 'see less'
            : `see more (${String(values.length - SEE_MORE_THRESHOLD)} more)`}
        </Button>
      )}
    </>
  )
}
