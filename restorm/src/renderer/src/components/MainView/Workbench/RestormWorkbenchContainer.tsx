import React from 'react'
import type { WorkbenchTree, RebuildTabCallback } from 'electron-core-ui/renderer'
import { RestormWorkbench, type RestormWorkbenchHandle } from './RestormWorkbench'
import type { AddChildKind } from '../Sidebar/contextMenuBuilder'
import { EnvironmentValuesProvider } from '../../../contexts/EnvironmentValuesContext'
import type { Icon } from 'electron-core-ui/types'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import type { Request, Folder, Scenario, EnvironmentFolder, ScenarioNode, ScenarioEdge, ApiDesign } from '../../../../../shared/types/collections'
import type { ScenarioRequestUsage, ScenarioScenarioUsage } from '../../../services/scenarioRequestUsage'
import type { ResolveBoundItem, ResolveRequestEnv } from '../../Scenario/scenarioBoundResolver'
import type { SyntheticRequestPreview } from '../../../../../shared/utils/syntheticRequestPreview'
import type { SplitDirection } from 'electron-core-ui/renderer'

export interface RestormWorkbenchContainerProps {
  workbenchRef?: React.Ref<RestormWorkbenchHandle>
  tree: WorkbenchTree
  dirtyItemIdsSet?: ReadonlySet<string> | undefined
  onTreeChange: (tree: WorkbenchTree) => void
  focusedGroupId: string | null
  onFocusedGroupChange: (groupId: string | null) => void
  /** Forwarded from `EditorWorkbench`: the maximized (fullscreen) tab
   * changed (id, or null when restored). The host tracks this to keep
   * the MCP workbench-layout snapshot fresh. */
  onFullscreenTabIdChange?: ((tabId: string | null) => void) | undefined
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
  /** Predicate marking a non-editor-tab drag (a sidebar list item) as
   * one the workbench should show the split overlay for. */
  isWorkbenchExternalDrop?: (event: DragEvent) => boolean
  /** Open a dragged sidebar item beside the drop target — the workbench
   * resolved the released group + split zone. */
  onWorkbenchExternalDrop?: (event: DragEvent, targetGroupId: string, direction: SplitDirection) => void
  resolveRequestEnv?: ResolveRequestEnv
  resolveSyntheticPreview?: (requestId: string) => SyntheticRequestPreview | null
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
  getScenariosUsingQuickConfig?: (quickConfigId: string) => ScenarioRequestUsage[]
  onOpenScenarioFromRequest?: (scenarioId: string, focusNodeId?: string) => void
  getScenariosUsingScenario?: (scenarioId: string) => ScenarioScenarioUsage[]
  getFolderById: (id: string) => Folder | undefined
  getScenarioById: (id: string) => Scenario | undefined
  getDesignById: (id: string) => ApiDesign | undefined
  getEnvironmentFolderById: (id: string) => EnvironmentFolder | undefined
  navigationEnabled?: boolean | undefined
  tabSwitcherAnchorSelector?: string | undefined
  projectUuid?: string | null | undefined
  /** Bumped after a clean git pull re-hydrates the tree; forwarded to
   * RestormWorkbench so open request tabs remount and re-read pulled values. */
  tabReloadEpoch?: number | undefined
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
  onFullscreenTabIdChange,
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
  isWorkbenchExternalDrop,
  onWorkbenchExternalDrop,
  resolveRequestEnv,
  resolveSyntheticPreview,
  onEnvironmentFolderChange,
  onSizesChange,
  emptyFallback,
  workbenchId,
  onRebuildTab,
  onStateRestored,
  getRequestById,
  getScenariosUsingRequest,
  getScenariosUsingQuickConfig,
  getScenariosUsingScenario,
  onOpenScenarioFromRequest,
  getFolderById,
  getScenarioById,
  getDesignById,
  getEnvironmentFolderById,
  navigationEnabled,
  tabSwitcherAnchorSelector,
  projectUuid,
  tabReloadEpoch,
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
          onFullscreenTabIdChange={onFullscreenTabIdChange}
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
          {...(isWorkbenchExternalDrop ? { isWorkbenchExternalDrop } : {})}
          {...(onWorkbenchExternalDrop ? { onWorkbenchExternalDrop } : {})}
          {...(resolveRequestEnv ? { resolveRequestEnv } : {})}
          {...(resolveSyntheticPreview ? { resolveSyntheticPreview } : {})}
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
          getScenariosUsingQuickConfig={getScenariosUsingQuickConfig}
          getScenariosUsingScenario={getScenariosUsingScenario}
          onOpenScenarioFromRequest={onOpenScenarioFromRequest}
          getFolderById={getFolderById}
          getScenarioById={getScenarioById}
          getDesignById={getDesignById}
          getEnvironmentFolderById={getEnvironmentFolderById}
          navigationEnabled={navigationEnabled}
          tabSwitcherAnchorSelector={tabSwitcherAnchorSelector}
          projectUuid={projectUuid}
          tabReloadEpoch={tabReloadEpoch}
          isItemFavorite={isItemFavorite}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
    </EnvironmentValuesProvider>
  )
}
