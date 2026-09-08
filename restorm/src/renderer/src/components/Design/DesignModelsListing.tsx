import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, MarkdownViewer } from 'electron-core-ui/renderer'
import type { ApiDesign } from '../../../../shared/types/collections'
import { modelsClassDiagram } from '../../../../shared/design/designModelsDiagram'
import { DesignEntityListing } from './DesignEntityListing'
import type { DesignEntityActionHandler } from '../../services/designSidebarNodes'

/**
 * The Models section-root view: a "List" tab (the fully-expanded listing with an
 * add button) and a "Graph" tab (a mermaid class diagram of the models, their
 * inheritance and references — the models-only counterpart of the API docs
 * graph). When there are no models the listing shows its own centered prompt.
 */
export const DesignModelsListing: React.FC<{
  design: ApiDesign
  onSelect: (entityId: string) => void
  onAction?: DesignEntityActionHandler
}> = ({ design, onSelect, onAction }) => {
  const { t } = useTranslation()
  // Key on `design.models` (a NEW array on every model mutation — add, rename,
  // reparent, reference edit — via `assignDesignSection`), NOT the stable
  // `design` proxy, or the diagram would go stale after e.g. a sidebar DnD that
  // reparents a model for inheritance.
  const diagram = useMemo(() => `\`\`\`mermaid\n${modelsClassDiagram(design.models)}\n\`\`\``, [design.models])
  const list = <DesignEntityListing design={design} section="models" onSelect={onSelect} {...(onAction ? { onAction } : {})} />
  if (design.models.length === 0) return list
  return (
    <div className="design-models-view" data-testid="design-models-view">
      <Tabs
        data-testid="design-models-view-tabs"
        mountStrategy="lazy-once"
        tabs={[
          { id: 'list', label: t('design.listing.tabs.list', 'List'), content: list },
          {
            id: 'graph',
            label: t('design.listing.tabs.graph', 'Graph'),
            content: (
              <div className="design-models-graph" data-testid="design-models-graph">
                <MarkdownViewer value={diagram} allowMermaid />
              </div>
            )
          }
        ]}
      />
    </div>
  )
}
