import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListView, ScrollableElement, Button, type ListViewItemData } from 'electron-core-ui/renderer'
import type { ApiDesign } from '../../../../shared/types/collections'
import { parseDesignEntityRowId, type DesignEntitySection } from '../../../../shared/design/designSections'
import { designSectionChildren, type DesignEntityActionHandler } from '../../services/designSidebarNodes'
import { renameDesignEntity } from './designMutations'

/** All expandable row ids in a tree (so the listing opens fully expanded). */
function collectIds(rows: ListViewItemData[], out: Set<string>): Set<string> {
  for (const row of rows) {
    if (row.children !== undefined && row.children.length > 0) {
      out.add(row.id)
      collectIds(row.children, out)
    }
  }
  return out
}

const ADD_LABEL: Record<DesignEntitySection, [string, string]> = {
  models: ['design.models.add', 'Add a model'],
  enums: ['design.enums.addEnum', 'Add an enum'],
  routes: ['design.routes.addRoute', 'Add a route']
}
const EMPTY_LABEL: Record<DesignEntitySection, [string, string]> = {
  models: ['design.listing.models.empty', 'Create your first model'],
  enums: ['design.listing.enums.empty', 'Create your first enum'],
  routes: ['design.listing.routes.empty', 'Create your first route']
}

/**
 * The section-root overview: when no entity is selected, a section (Models /
 * Enums / Routes) lists everything beneath it — fully expanded, like the Clients
 * listing while serving. Each row selects its entity on click and reuses the
 * add / rename / delete actions; an "Add" button (and, when empty, a centered
 * primary prompt) create a new one and jump to it.
 */
export const DesignEntityListing: React.FC<{
  design: ApiDesign
  section: DesignEntitySection
  onSelect: (entityId: string) => void
  onAction?: DesignEntityActionHandler
}> = ({ design, section, onSelect, onAction }) => {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const isEmpty = section === 'models'
    ? design.models.length === 0
    : section === 'enums'
      ? design.enums.length === 0
      : design.routeGroups.length === 0

  const rows = useMemo(() => {
    // Expand everything by default: seed expandedIds with every expandable id
    // (minus what the user explicitly collapsed).
    const built = designSectionChildren(design, section, { expandedIds: new Set(), detailed: true, ...(onAction ? { onDesignEntityAction: onAction } : {}) })
    const allExpandable = collectIds(built, new Set())
    const expandedIds = new Set([...allExpandable].filter((id) => !collapsed.has(id)))
    return designSectionChildren(design, section, { expandedIds, detailed: true, ...(onAction ? { onDesignEntityAction: onAction } : {}) })
  }, [design, section, collapsed, onAction])

  const addEntity = (): void => { onAction?.(design.id, section, 'add') }
  const [addKey, addFallback] = ADD_LABEL[section]
  const [emptyKey, emptyFallback] = EMPTY_LABEL[section]

  if (isEmpty) {
    return (
      <div className={`design-entity-listing design-entity-listing-empty design-${section}-listing-view`} data-testid={`design-${section}-listing`}>
        <div className="design-entity-listing-empty-inner">
          <p className="design-entity-listing-empty-message">{t(emptyKey, emptyFallback)}</p>
          <Button icon="add" onClick={addEntity} data-testid={`design-${section}-listing-empty-add`}>
            {t(addKey, addFallback)}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={`design-entity-listing design-${section}-listing-view`} data-testid={`design-${section}-listing`}>
      <div className="design-entity-listing-toolbar">
        <Button secondary icon="add" onClick={addEntity} options={{ ariaLabel: t(addKey, addFallback) }} data-testid={`design-${section}-listing-add`}>
          {t(addKey, addFallback)}
        </Button>
      </div>
      <ScrollableElement className="design-entity-listing-scroll">
        <ListView
          items={rows}
          rootRole="tree"
          expandOnChevronOnly
          onItemClick={(payload) => {
            const parsed = parseDesignEntityRowId(payload.item.id)
            if (parsed !== null) onSelect(parsed.entityId)
          }}
          isRenameable
          onItemRename={(payload, newName) => {
            const parsed = parseDesignEntityRowId(payload.item.id)
            if (parsed !== null) renameDesignEntity(design, section, parsed.entityId, newName)
          }}
          onItemToggle={(payload, expanded) => {
            setCollapsed((prev) => {
              const next = new Set(prev)
              if (expanded) next.delete(payload.item.id)
              else next.add(payload.item.id)
              return next
            })
          }}
          data-testid={`design-${section}-listing-listview`}
        />
      </ScrollableElement>
    </div>
  )
}
