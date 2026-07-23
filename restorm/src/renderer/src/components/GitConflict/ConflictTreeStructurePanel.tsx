import React, { useMemo } from 'react'
import { ListView, type ListViewItemData } from 'electron-core-ui/renderer'
import type { FolderItem, Folder, EnvironmentFolder } from '../../../../shared/types/folderTypes'
import type { Request } from '../../../../shared/types/requests'
import { folderAsRootListViewItem, folderItemToListViewItem, collectExpandableIds } from '../../services/FolderToListView'
import { Badge } from '../common/Badge'
import { RegistryBadge } from '../common/RegistryBadge'
import { mapToBadgeType, requestBadgeId } from '../../utils/badgeUtils'
import { httpBadgeIdFor, isKnownHttpMethod } from '../../../../shared/utils/httpMethod'
import './conflictTreeStructurePanel.css'

export interface ConflictTreeStructurePanelProps {
  /** This side's project, as the sidebar would list it. */
  items: FolderItem[]
  /** Ids that sit in a different folder on the other side — outlined so
   * the user sees WHICH items moved instead of comparing two hierarchies
   * by eye. */
  movedItemIds: string[]
  'data-testid'?: string
}

function isFolderLike(item: FolderItem): item is Folder | EnvironmentFolder {
  return Array.isArray((item as FolderItem & { items?: unknown }).items)
}

/**
 * One side's hierarchy, rendered through the SAME `ListView` + the same
 * item conversion the sidebar uses — so the rows, the icons and the
 * protocol badges are the ones the user already knows. Rebuilding a
 * lookalike here would drift from the sidebar on the next badge change.
 *
 * The tree shape is arbitrated as a whole (a simple left/right choice, no
 * per-item reorganisation), so this panel is a read-only picture on every
 * column; what it has to make obvious is WHERE each contested item sits.
 */
export const ConflictTreeStructurePanel: React.FC<ConflictTreeStructurePanelProps> = ({
  items,
  movedItemIds,
  'data-testid': dataTestId
}) => {
  const testId = dataTestId ?? 'conflict-tree-structure'

  const listItems: ListViewItemData[] = useMemo(() => {
    // Everything expanded: a collapsed branch could hide the very item the
    // red outline is meant to point at.
    const expandedIds = new Set(items.flatMap((item) => collectExpandableIds(item)))
    const options = {
      expandedIds,
      renderMethodBadge: (method: string) => <RegistryBadge badgeId={httpBadgeIdFor(method)} text={method} />,
      renderProtocolBadge: (protocol: string, label?: string, mode?: 'client' | 'server') =>
        (mode === 'server' && isKnownHttpMethod(protocol))
          ? <RegistryBadge badgeId={httpBadgeIdFor(protocol)} text={label ?? protocol} server />
          : <Badge type={mapToBadgeType(protocol)} label={label} mode={mode} />,
      renderRequestBadge: (request: Request) => <RegistryBadge badgeId={requestBadgeId(request)} />
    }
    return items.map((item) => (
      isFolderLike(item)
        ? folderAsRootListViewItem(item, options)
        : folderItemToListViewItem(item, options)
    ))
  }, [items])

  // `ListViewItemData` carries no per-row class, but every row exposes its
  // `data-item-id` — so the outline is a scoped CSS rule rather than a
  // change to the shared component (or a lookalike tree of our own).
  const outlineRule = movedItemIds.length === 0
    ? ''
    : movedItemIds
        .map((id) => `.conflict-tree-structure [data-item-id="${id}"]`)
        .join(', ') + ' { border-color: var(--inputValidation-errorBorder, #be1100) !important; }'

  return (
    <div className="conflict-tree-structure" data-testid={testId}>
      {outlineRule !== '' && <style>{outlineRule}</style>}
      <ListView
        items={listItems}
        ariaLabel="tree structure"
        selectedIds={[]}
        data-testid={`${testId}-list`}
      />
    </div>
  )
}
