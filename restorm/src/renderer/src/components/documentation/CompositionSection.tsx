import React from 'react'
import type { ModelDocumentation } from '../../../../shared/types/apiDocumentation'
import { ModelRefLink } from './ModelRefLink'

export interface CompositionSectionProps {
  /** Models the host is rendering. We surface only those whose
   * `composition` field is non-empty (oneOf / anyOf / discriminator). */
  models: ModelDocumentation[]
  /** Optional test id stamped on the root container. */
  testId?: string
  /** Heading level for the "Polymorphism" title. H1 in single-route
   * scope (peer of the route summary), H2 in folder / env-folder
   * scope (sibling of the scope H1 + per-tag group H2). */
  headingLevel?: 1 | 2
}

/**
 * Per-model polymorphism summary: lists every model that carries a
 * `oneOf` / `anyOf` / `discriminator` block, with the variant model
 * names rendered as `<ModelRefLink>`s. Read-only — clicking a
 * variant navigates the React Flow graph to that node via the
 * standard documentation navigation context.
 *
 * Models with neither composition nor a discriminator are omitted
 * (no empty section). The whole component returns null when no
 * model in scope declares any composition.
 */
export const CompositionSection: React.FC<CompositionSectionProps> = ({ models, testId, headingLevel = 1 }) => {
  const polymorphic = models.filter((m) => m.composition !== undefined)
  if (polymorphic.length === 0) return null

  return (
    <section
      className="documentation-host-composition"
      data-testid={testId ?? 'documentation-host-composition'}
    >
      {headingLevel === 1
        ? <h1 className="documentation-host__section-title">Polymorphism</h1>
        : <h2 className="documentation-host__section-title">Polymorphism</h2>}
      <ul className="documentation-host-composition__list">
        {polymorphic.map((model) => {
          const c = model.composition
          if (c === undefined) return null
          return (
            <li key={model.name} className="documentation-host-composition__item">
              <div className="documentation-host-composition__model-name">
                <ModelRefLink modelName={model.name} />
              </div>
              {c.oneOf !== undefined && c.oneOf.length > 0 && (
                <CompositionLine label="oneOf" refs={c.oneOf} />
              )}
              {c.anyOf !== undefined && c.anyOf.length > 0 && (
                <CompositionLine label="anyOf" refs={c.anyOf} />
              )}
              {c.discriminator !== undefined && (
                <div className="documentation-host-composition__discriminator">
                  <span className="documentation-host-composition__line-label">discriminator</span>
                  <code className="documentation-host-composition__discriminator-property">
                    {c.discriminator.propertyName}
                  </code>
                  {c.discriminator.mapping !== undefined && Object.keys(c.discriminator.mapping).length > 0 && (
                    <ul className="documentation-host-composition__mapping">
                      {Object.entries(c.discriminator.mapping).map(([value, target]) => (
                        <li key={value} className="documentation-host-composition__mapping-row">
                          <code>{value}</code>
                          <span className="documentation-host-composition__mapping-arrow">→</span>
                          <ModelRefLink modelName={target} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface CompositionLineProps {
  label: string
  refs: string[]
}

const CompositionLine: React.FC<CompositionLineProps> = ({ label, refs }) => (
  <div className="documentation-host-composition__line">
    <span className="documentation-host-composition__line-label">{label}</span>
    <ul className="documentation-host-composition__refs">
      {refs.map((ref) => (
        <li key={ref} className="documentation-host-composition__ref">
          <ModelRefLink modelName={ref} />
        </li>
      ))}
    </ul>
  </div>
)
