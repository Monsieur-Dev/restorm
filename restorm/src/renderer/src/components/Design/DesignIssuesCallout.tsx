import React from 'react'
import { useTranslation } from 'react-i18next'
import { Callout } from 'electron-core-ui/renderer'
import type { DesignIssue } from '../../../../shared/design/validateApiDesign'
import type { ApiDesign } from '../../../../shared/types/apiDesign'

type DesignJumpSection = 'models' | 'routes' | 'enums'

/** Resolve a collision twin's entity id to the section it lives in + a short
 * label for the link. Returns null for an id that no longer resolves (a twin
 * deleted between validation and render). */
function resolveTwin(design: ApiDesign, id: string): { section: DesignJumpSection; label: string } | null {
  const model = design.models.find((m) => m.id === id)
  if (model !== undefined) return { section: 'models', label: model.doc.name }
  const enumEntity = design.enums.find((e) => e.id === id)
  if (enumEntity !== undefined) return { section: 'enums', label: enumEntity.doc.name }
  for (const group of design.routeGroups) {
    const route = group.routes.find((r) => r.id === id)
    if (route !== undefined) {
      return { section: 'routes', label: `${route.doc.match.method ?? 'GET'} ${group.doc.name}${route.doc.match.urlPattern}` }
    }
  }
  return null
}

const TWIN_ICON: Record<DesignJumpSection, string> = {
  models: 'symbol-class',
  enums: 'symbol-enum',
  routes: 'arrow-swap'
}

/**
 * Entity-level validation errors surfaced as a stack of error callouts at the
 * top of a model / enum / route(-group) detail pane. Only the issues whose id
 * path ENDS at this entity are shown (a name collision, a duplicate, an empty
 * name, a dangling reference the entity itself carries) — the sub-rows
 * (properties, params, responses) surface their own inline errors, so listing
 * them here too would double up.
 *
 * A name/path collision issue also carries `collisionWith` (the other members
 * of the group). When `design` + `onJumpTo` are provided, each is rendered as a
 * clickable chip that navigates to the colliding twin — so from any member of a
 * collision the user can reach the others.
 */
export const DesignIssuesCallout: React.FC<{
  issues: readonly DesignIssue[]
  entityId: string
  design?: ApiDesign | undefined
  onJumpTo?: ((section: DesignJumpSection, entityId: string) => void) | undefined
}> = ({ issues, entityId, design, onJumpTo }) => {
  const { t } = useTranslation()
  const mine = issues.filter((iss) => iss.path[iss.path.length - 1] === entityId)
  if (mine.length === 0) return null
  return (
    <div className="design-entity-issues-callout" data-testid="design-entity-issues-callout">
      {mine.map((iss, i) => {
        const label = t(`design.issue.${iss.code}`, iss.code)
        const message = iss.subject !== undefined && iss.subject !== '' ? `${label} — ${iss.subject}` : label
        const twins = design !== undefined && onJumpTo !== undefined
          ? (iss.collisionWith ?? [])
              .map((id) => ({ id, resolved: resolveTwin(design, id) }))
              .filter((tw): tw is { id: string; resolved: { section: DesignJumpSection; label: string } } => tw.resolved !== null)
          : []
        return (
          <React.Fragment key={`${iss.code}-${i}`}>
            <Callout variant="error" message={message} />
            {twins.length > 0 && (
              <div className="design-collision-twins" data-testid={`design-collision-twins-${entityId}`}>
                <span className="design-collision-twins-label">{t('design.issue.collidesWith', 'Collides with:')}</span>
                {twins.map(({ id, resolved }) => (
                  <button
                    key={id}
                    type="button"
                    className="design-collision-twin-chip"
                    onClick={() => { onJumpTo?.(resolved.section, id) }}
                    data-testid={`design-collision-twin-${id}`}
                  >
                    <span className={`codicon codicon-${TWIN_ICON[resolved.section]}`} aria-hidden="true" />
                    {resolved.label}
                  </button>
                ))}
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
