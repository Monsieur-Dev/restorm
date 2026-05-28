import React from 'react'
import type { WorkbenchTree, RebuildTabCallback } from 'electron-core-ui/renderer'
import { RestormWorkbench, type RestormWorkbenchHandle } from './RestormWorkbench'
import type { AddChildKind } from '../Sidebar/contextMenuBuilder'
import { EnvironmentValuesProvider } from '../../../contexts/EnvironmentValuesContext'
import type { Icon } from 'electron-core-ui/types'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import type { Request, Folder, EnvironmentFolder, ScenarioNode, ScenarioEdge } from '../../../../../shared/types/collections'
import type { ScenarioRequestUsage, ScenarioScenarioUsage } from '../../../services/scenarioRequestUsage'
import type { ResolveBoundItem, ResolveRequestEnv } from '../../Scenario/scenarioBoundResolver'

export interface RestormWorkbenchContainerProps {
  workbenchRef?: React.Ref<RestormWorkbenchHandle>
  tree: WorkbenchTree
  dirtyItemIdsSet?: ReadonlySet<string> | undefined
  onTreeChange: (tree: WorkbenchTree) => void
  focusedGroupId: string | null
  onFocusedGroupChange: (groupId: string | null) => void
  onTabActivate: (tabId: string) => void
  /** Open a request by id — same handler the sidebar wires for clicks.
   *  Passed through to env-folder home tabs so the Favorite Requests
   *  rows open the matching request. */
  onRequestClick?: (requestId: string) => void
  /** Middle-click variant of `onRequestClick` — opens the request tab
   *  without focusing it. Threaded down so the Favorite Requests rows
   *  can mirror the sidebar's middle-click "open in background"
   *  gesture. */
  onRequestAuxClick?: (requestId: string) => void
  onBreadcrumbClick: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  /** Middle-click on a non-last breadcrumb segment — "open tab in background". */
  onBreadcrumbAuxClick?: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  onItemRename: (item: BreadcrumbItem, newName: string) => void
  onItemIconChange?: (item: BreadcrumbItem, newIcon: Icon | null) => void
  onTagsChange: (targetId: string, tags: string[]) => void
  onTagColorChange?: (envFolderId: string, tag: string, color: string | null) => void
  onFolderChange: (folderId: string, folder: Folder) => void
  onScenarioChange?: (scenarioId: string, patch: { nodes?: ScenarioNode[]; edges?: ScenarioEdge[]; notes?: string }) => void
  /** Create a new HTTP request as a child of the scenario (id) and return its
   * id — used when a "Requête HTTP" node is added to the graph. */
  onCreateScenarioRequest?: (scenarioId: string) => string | null
  /** Create a child item of the given kind (request protocol or sub-scenario)
   * under the scenario from the graph add-palette, returning its id. */
  onCreateScenarioChild?: (scenarioId: string, kind: AddChildKind) => string | null
  resolveBoundItem?: ResolveBoundItem
  resolveRequestEnv?: ResolveRequestEnv
  onEnvironmentFolderChange: (folderId: string, folder: EnvironmentFolder) => void
  onSizesChange: (nodeId: string, sizes: number[]) => void
  emptyFallback: React.ReactNode
  workbenchId?: string | undefined
  /** Pass `undefined` to delay ECUI's autosave restore until the
   * caller has the data needed to reconstruct tabs (e.g., until
   * `rootItems` is non-empty). When the prop later becomes a real
   * callback, ECUI's restore-effect re-runs and rebuilds the
   * persisted tabs successfully. Without this, restore would
   * race with `rootItems` loading and drop every request tab —
   * and the autosave that follows would corrupt the persisted
   * state with the truncated tree. */
  onRebuildTab: RebuildTabCallback | undefined
  onStateRestored: (tree: WorkbenchTree | null) => void
  getRequestById: (id: string) => Request | undefined
  getScenariosUsingRequest?: (requestId: string) => ScenarioRequestUsage[]
  onOpenScenarioFromRequest?: (scenarioId: string, focusNodeId?: string) => void
  getScenariosUsingScenario?: (scenarioId: string) => ScenarioScenarioUsage[]
  getFolderById: (id: string) => Folder | undefined
  getEnvironmentFolderById: (id: string) => EnvironmentFolder | undefined
  navigationEnabled?: boolean | undefined
  tabSwitcherAnchorSelector?: string | undefined
  projectUuid?: string | null | undefined
  isItemFavorite?: (itemId: string) => boolean
  onToggleFavorite?: (itemId: string) => void
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
  onRequestClick,
  onRequestAuxClick,
  onBreadcrumbClick,
  onBreadcrumbAuxClick,
  onItemRename,
  onItemIconChange,
  onTagsChange,
  onTagColorChange,
  onFolderChange,
  onScenarioChange,
  onCreateScenarioRequest,
  onCreateScenarioChild,
  resolveBoundItem,
  resolveRequestEnv,
  onEnvironmentFolderChange,
  onSizesChange,
  emptyFallback,
  workbenchId,
  onRebuildTab,
  onStateRestored,
  getRequestById,
  getScenariosUsingRequest,
  getScenariosUsingScenario,
  onOpenScenarioFromRequest,
  getFolderById,
  getEnvironmentFolderById,
  navigationEnabled,
  tabSwitcherAnchorSelector,
  projectUuid,
  isItemFavorite,
  onToggleFavorite
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
          {...(onRequestClick ? { onRequestClick } : {})}
          {...(onRequestAuxClick ? { onRequestAuxClick } : {})}
          onBreadcrumbClick={onBreadcrumbClick}
          {...(onBreadcrumbAuxClick ? { onBreadcrumbAuxClick } : {})}
          onItemRename={onItemRename}
          onItemIconChange={onItemIconChange}
          onTagsChange={onTagsChange}
          onTagColorChange={onTagColorChange}
          onFolderChange={onFolderChange}
          {...(onScenarioChange ? { onScenarioChange } : {})}
          {...(onCreateScenarioRequest ? { onCreateScenarioRequest } : {})}
          {...(onCreateScenarioChild ? { onCreateScenarioChild } : {})}
          {...(resolveBoundItem ? { resolveBoundItem } : {})}
          {...(resolveRequestEnv ? { resolveRequestEnv } : {})}
          onEnvironmentFolderChange={onEnvironmentFolderChange}
          onSizesChange={onSizesChange}
          emptyFallback={emptyFallback}
          style={{ flex: 1 }}
          workbenchId={workbenchId}
          autosave
          onRebuildTab={onRebuildTab}
          onStateRestored={onStateRestored}
          getRequestById={getRequestById}
          getScenariosUsingRequest={getScenariosUsingRequest}
          getScenariosUsingScenario={getScenariosUsingScenario}
          onOpenScenarioFromRequest={onOpenScenarioFromRequest}
          getFolderById={getFolderById}
          getEnvironmentFolderById={getEnvironmentFolderById}
          navigationEnabled={navigationEnabled}
          tabSwitcherAnchorSelector={tabSwitcherAnchorSelector}
          projectUuid={projectUuid}
          isItemFavorite={isItemFavorite}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
    </EnvironmentValuesProvider>
  )
}

export default RestormWorkbenchContainer
