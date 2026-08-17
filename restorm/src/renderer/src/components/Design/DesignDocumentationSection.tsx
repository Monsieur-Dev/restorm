import React, { useCallback, useMemo } from 'react'
import type { ApiDesign } from '../../../../shared/types/collections'
import type { OperationDocumentation } from '../../../../shared/types/apiDocumentation'
import { designToApiDocumentation } from '../../../../shared/design/apiDesignDoc'
import { DocumentationHost } from '../documentation/DocumentationHost'

export interface DesignDocumentationSectionProps {
  design: ApiDesign
  /** Bumped on every DESIGN_UPDATED — re-derives the projection so the
   * doc reflects edits live (a renamed model re-renders immediately). */
  designTick: number
  /** Jump to an entity's editable card (single-tab navigation). */
  onJumpTo: (section: 'models' | 'routes' | 'enums', entityId: string) => void
}

/**
 * The design's Documentation section: the SAME readable view an
 * imported API gets — `DocumentationHost` fed by the design's live
 * projection. The doc stays the readable surface; each route block and
 * model node carries an edit button jumping to the corresponding
 * design card. No "+ Add a request": a design documents itself, it is
 * not an import source to materialise requests from.
 */
export const DesignDocumentationSection: React.FC<DesignDocumentationSectionProps> = ({ design, designTick, onJumpTo }) => {
  // Projection + the index-aligned route-id table: the projection
  // flattens `routeGroups[].routes[]` in order, so `operations[i]`
  // maps back to the i-th flattened route id — no name matching.
  const { doc, routeIdByIndex } = useMemo(() => {
    void designTick
    return {
      doc: designToApiDocumentation(design),
      routeIdByIndex: design.routeGroups.flatMap((group) => group.routes.map((route) => route.id))
    }
  }, [design, designTick])

  const editModel = useCallback((modelName: string) => {
    const model = design.models.find((m) => m.doc.name === modelName)
    if (model !== undefined) {
      onJumpTo('models', model.id)
      return
    }
    // Enum-shaped components project as models too — route them to the
    // Enums section (no per-entity selection there yet).
    const enumEntity = design.enums.find((e) => e.doc.name === modelName)
    if (enumEntity !== undefined) onJumpTo('enums', enumEntity.id)
  }, [design, onJumpTo])

  const editOperation = useCallback((operation: OperationDocumentation) => {
    const index = doc.operations.indexOf(operation)
    const routeId = routeIdByIndex[index]
    if (routeId !== undefined) onJumpTo('routes', routeId)
  }, [doc, routeIdByIndex, onJumpTo])

  return (
    <div className="design-doc-section" data-testid="design-documentation-section">
      <DocumentationHost
        apiDocumentation={doc}
        {...(doc.api.title.length > 0 ? { scopeTitle: doc.api.title } : {})}
        {...(doc.api.description !== undefined && doc.api.description.length > 0
          ? { scopeDescription: doc.api.description }
          : {})}
        showApiInfo
        hideAddRequest
        onEditModel={editModel}
        onEditOperation={editOperation}
        testId="design-documentation-host"
      />
    </div>
  )
}
