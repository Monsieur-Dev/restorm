import React from 'react'
import type { WorkbenchTree, RebuildTabCallback } from 'electron-core-ui/renderer'
import { RestormWorkbench, type RestormWorkbenchHandle } from './RestormWorkbench'
import { EnvironmentValuesProvider } from '../../../contexts/EnvironmentValuesContext'
import type { BreadcrumbItem } from '../../../types/editor'
import type { Request, Folder, EnvironmentFolder } from '../../../types/collections'

export interface RestormWorkbenchContainerProps {
  workbenchRef?: React.Ref<RestormWorkbenchHandle>
  tree: WorkbenchTree
  onTreeChange: (tree: WorkbenchTree) => void
  focusedGroupId: string | null
  onFocusedGroupChange: (groupId: string | null) => void
  onTabActivate: (tabId: string) => void
  onBreadcrumbClick: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  onItemRename: (item: BreadcrumbItem, newName: string) => void
  onTagsChange: (targetId: string, tags: string[]) => void
  onFolderChange: (folderId: string, folder: Folder) => void
  onEnvironmentFolderChange: (folderId: string, folder: EnvironmentFolder) => void
  onSizesChange: (nodeId: string, sizes: number[]) => void
  emptyFallback: React.ReactNode
  workbenchId: string
  onRebuildTab: RebuildTabCallback
  onStateRestored: (tree: WorkbenchTree | null) => void
  getRequestById: (id: string) => Request | undefined
  getFolderById: (id: string) => Folder | undefined
  getEnvironmentFolderById: (id: string) => EnvironmentFolder | undefined
}

/**
 * Container for the main workbench with environment context
 */
export const RestormWorkbenchContainer: React.FC<RestormWorkbenchContainerProps> = ({
  workbenchRef,
  tree,
  onTreeChange,
  focusedGroupId,
  onFocusedGroupChange,
  onTabActivate,
  onBreadcrumbClick,
  onItemRename,
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
  getEnvironmentFolderById
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
          onTreeChange={onTreeChange}
          focusedGroupId={focusedGroupId}
          onFocusedGroupChange={onFocusedGroupChange}
          onTabActivate={onTabActivate}
          onBreadcrumbClick={onBreadcrumbClick}
          onItemRename={onItemRename}
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
        />
      </div>
    </EnvironmentValuesProvider>
  )
}

export default RestormWorkbenchContainer
