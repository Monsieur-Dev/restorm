import React from 'react'
import type { WorkbenchTree, RebuildTabCallback } from 'electron-core-ui/renderer'
import { RestormWorkbench, type RestormWorkbenchHandle } from './RestormWorkbench'
import { EnvironmentValuesProvider } from '../../../contexts/EnvironmentValuesContext'
import type { Icon } from 'electron-core-ui/types'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import type { Request, Folder, EnvironmentFolder } from '../../../../../shared/types/collections'

export interface RestormWorkbenchContainerProps {
  workbenchRef?: React.Ref<RestormWorkbenchHandle>
  tree: WorkbenchTree
  dirtyItemIdsSet?: Set<string> | undefined
  onTreeChange: (tree: WorkbenchTree) => void
  focusedGroupId: string | null
  onFocusedGroupChange: (groupId: string | null) => void
  onTabActivate: (tabId: string) => void
  onBreadcrumbClick: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  onItemRename: (item: BreadcrumbItem, newName: string) => void
  onItemIconChange?: (item: BreadcrumbItem, newIcon: Icon | null) => void
  onTagsChange: (targetId: string, tags: string[]) => void
  onFolderChange: (folderId: string, folder: Folder) => void
  onEnvironmentFolderChange: (folderId: string, folder: EnvironmentFolder) => void
  onSizesChange: (nodeId: string, sizes: number[]) => void
  emptyFallback: React.ReactNode
  workbenchId?: string | undefined
  onRebuildTab: RebuildTabCallback
  onStateRestored: (tree: WorkbenchTree | null) => void
  getRequestById: (id: string) => Request | undefined
  getFolderById: (id: string) => Folder | undefined
  getEnvironmentFolderById: (id: string) => EnvironmentFolder | undefined
  navigationEnabled?: boolean | undefined
  tabSwitcherAnchorSelector?: string | undefined
}

/**
 * Container for the main workbench with environment context
 */
export const RestormWorkbenchContainer: React.FC<RestormWorkbenchContainerProps> = ({
  workbenchRef,
  tree,
  dirtyItemIdsSet,
  onTreeChange,
  focusedGroupId,
  onFocusedGroupChange,
  onTabActivate,
  onBreadcrumbClick,
  onItemRename,
  onItemIconChange,
  onTagsChange,
  onFolderChange,
  onEnvironmentFolderChange,
  onSizesChange,
  emptyFallback,
  workbenchId,
  onRebuildTab,
  onStateRestored,
  getRequestById,
  getFolderById,
  getEnvironmentFolderById,
  navigationEnabled,
  tabSwitcherAnchorSelector
}) => {
  return (
    <EnvironmentValuesProvider>
      <div
        style={{
          flex: 1,
          minWidth: 240,
          minHeight: 0,
          display: 'flex'
        }}
      >
        <RestormWorkbench
          ref={workbenchRef}
          tree={tree}
          dirtyItemIdsSet={dirtyItemIdsSet}
          onTreeChange={onTreeChange}
          focusedGroupId={focusedGroupId}
          onFocusedGroupChange={onFocusedGroupChange}
          onTabActivate={onTabActivate}
          onBreadcrumbClick={onBreadcrumbClick}
          onItemRename={onItemRename}
          onItemIconChange={onItemIconChange}
          onTagsChange={onTagsChange}
          onFolderChange={onFolderChange}
          onEnvironmentFolderChange={onEnvironmentFolderChange}
          onSizesChange={onSizesChange}
          emptyFallback={emptyFallback}
          style={{ flex: 1 }}
          workbenchId={workbenchId}
          autosave
          onRebuildTab={onRebuildTab}
          onStateRestored={onStateRestored}
          getRequestById={getRequestById}
          getFolderById={getFolderById}
          getEnvironmentFolderById={getEnvironmentFolderById}
          navigationEnabled={navigationEnabled}
          tabSwitcherAnchorSelector={tabSwitcherAnchorSelector}
        />
      </div>
    </EnvironmentValuesProvider>
  )
}

export default RestormWorkbenchContainer
