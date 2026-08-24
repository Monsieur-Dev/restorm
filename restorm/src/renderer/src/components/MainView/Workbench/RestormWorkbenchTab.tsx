import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as CoreUIRenderer from 'electron-core-ui/renderer'
import { Callout, EditableLabel, IconSelect, BookmarkRibbonStack, Toggle, type Bookmark, type CalloutVariant } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import './restormWorkbenchTab.css'
import { WorkbenchTabHostContext } from '../../../contexts/workbenchTabHost'

const { Breadcrumb } = CoreUIRenderer as unknown as {
  Breadcrumb: React.ComponentType<{
    items: BreadcrumbItem[]
    onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
    onItemAuxClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
    onLastItemChange?: (item: BreadcrumbItem, newValue: string, index: number) => void
    onLastItemIconChange?: (item: BreadcrumbItem, newIcon: Icon | null, index: number) => void
    canEditIcon?: boolean
    canEditName?: boolean
    allNavigable?: boolean
    'data-testid'?: string
  }>
}

export interface RestormWorkbenchTabCallout {
  /** The variant/style of the callout */
  variant: CalloutVariant
  /** The message to display */
  message: string
  /** Optional custom icon (codicon name without 'codicon-' prefix) */
  icon?: string
}

export interface RestormWorkbenchTabProps {
  breadcrumbs: BreadcrumbItem[]
  onBreadcrumbClick?: ((item: BreadcrumbItem, index: number, isLast: boolean) => void) | undefined
  /** Middle-click on a non-last breadcrumb item. Used for the
   * "open tab in background" gesture — consumers typically open the
   * matching workbench tab without focusing it. */
  onBreadcrumbAuxClick?: ((item: BreadcrumbItem, index: number, isLast: boolean) => void) | undefined
  onBreadcrumbRename?: ((item: BreadcrumbItem, newValue: string) => void) | undefined
  onBreadcrumbIconChange?: ((item: BreadcrumbItem, newIcon: Icon | null) => void) | undefined
  tags: string[]
  onTagsChange?: ((nextTags: string[]) => void) | undefined
  /** Tag color map (tag label -> hex color) */
  tagColors?: Record<string, string> | undefined
  /** Called when a tag color changes. Pass null to remove the color. */
  onTagColorChange?: ((tag: string, color: string | null) => void) | undefined
  headerRight?: React.ReactNode
  /** Optional cluster of buttons anchored in the tab's top-right toolbar,
   * to the LEFT of the bookmark ribbon (e.g. a request's env selector +
   * history button). Rendered in a flex row; the wrapper positions it. */
  headerActions?: React.ReactNode
  /** Actions rendered BEFORE the bookmark ribbon (e.g. the env selector) —
   * the ribbon sits between this slot and `headerActions`. */
  headerActionsLeading?: React.ReactNode
  /** Optional action anchored in the tab's top-right toolbar, between the
   * bookmark ribbon and the favourite star (e.g. the "used in scenarios"
   * button). Brings its own absolute positioning. */
  topRightAction?: React.ReactNode
  /** Optional action anchored in the tab's top-right toolbar, immediately
   * to the LEFT of the favourite star (e.g. the auth-route key selector).
   * Positioned by the `.restorm-workbench-tab-star-left-action` wrapper
   * this renders it in. */
  starLeftAction?: React.ReactNode
  /** Optional callout to display at the top of the tab */
  callout?: RestormWorkbenchTabCallout | undefined
  /** Optional tab ID for stable test IDs */
  tabId?: string
  /** When defined, render a star toggle to the left of the H1 title.
   * The toggle's `checked` state mirrors `isFavorite`. Click flips
   * via `onToggleFavorite`. Both must be set for the toggle to appear. */
  isFavorite?: boolean
  onToggleFavorite?: () => void
  /** When false, the H1 title is read-only (no inline rename / pencil) —
   * used for the design tab's section pages, whose H1 is a section label,
   * not a renameable entity. Defaults to true. */
  titleEditable?: boolean
  /** When false, the tag/bookmark ribbon is hidden — designs carry no
   * bookmarks. Defaults to true. */
  showBookmarks?: boolean
  children: React.ReactNode
}

export const RestormWorkbenchTab: React.FC<RestormWorkbenchTabProps> = ({
  breadcrumbs,
  onBreadcrumbClick,
  onBreadcrumbAuxClick,
  onBreadcrumbRename,
  onBreadcrumbIconChange,
  tags,
  onTagsChange,
  tagColors,
  onTagColorChange,
  headerRight,
  headerActions,
  headerActionsLeading,
  topRightAction,
  starLeftAction,
  callout,
  tabId,
  isFavorite,
  onToggleFavorite,
  titleEditable = true,
  showBookmarks = true,
  children
}) => {
  const { t } = useTranslation()
  const testIdPrefix = tabId ? `tab-${tabId}` : 'workbench-tab'

  // Split the breadcrumb path: ancestors stay in the navigation row,
  // the last (current) item gets promoted to its own H1 title row
  // below. This matches the common "path > heading" layout in modern
  // editors and keeps the title visually prominent.
  const lastItem = breadcrumbs[breadcrumbs.length - 1]
  const ancestorBreadcrumbs = breadcrumbs.slice(0, -1)

  const handleTitleRename = useCallback((next: string) => {
    if (!lastItem) return
    onBreadcrumbRename?.(lastItem, next)
  }, [lastItem, onBreadcrumbRename])

  const handleTitleIconChange = useCallback((next: Icon | null) => {
    if (!lastItem) return
    onBreadcrumbIconChange?.(lastItem, next)
  }, [lastItem, onBreadcrumbIconChange])

  const ribbonBookmarks: Bookmark[] = tags.map((t) => {
    const col = tagColors?.[t]
    return col !== undefined ? { label: t, color: col } : { label: t }
  })

  const handleRibbonRename = useCallback((index: number, next: string) => {
    const nextTags = [...tags]
    nextTags[index] = next
    onTagsChange?.(nextTags)
  }, [tags, onTagsChange])

  const handleRibbonColorChange = useCallback((index: number, hex: string) => {
    const tag = tags[index]
    if (!tag) return
    onTagColorChange?.(tag, hex)
  }, [tags, onTagColorChange])

  const handleRibbonRemove = useCallback((index: number) => {
    const nextTags = tags.filter((_t, i) => i !== index)
    onTagsChange?.(nextTags)
  }, [tags, onTagsChange])

  const handleRibbonAdd = useCallback((label: string) => {
    onTagsChange?.([...tags, label])
  }, [tags, onTagsChange])

  return (
    <WorkbenchTabHostContext.Provider value={tabId ?? null}>
    <div className="restorm-workbench-tab">
      {/* Top-right cluster: optional header actions (e.g. a request's env
       * selector + history button) flow in a flex row to the LEFT of the
       * bookmark ribbon, so the ribbon's variable width never collides
       * with them. Anchored where the ribbon used to sit. */}
      <div className="restorm-workbench-tab-top-right">
        {/* Delimited background band drawn BEHIND the whole action cluster
         * (this group plus the scenario-usage button + favourite star that
         * anchor further right). A pure backdrop — absolutely positioned,
         * pointer-events:none, z-index:-1 — so it groups the controls
         * visually without shifting any of them. See restormWorkbenchTab.css
         * (`.restorm-workbench-tab-action-zone`). */}
        <div className="restorm-workbench-tab-action-zone" aria-hidden="true" />
        {/* Cluster order (left → right): leading actions (env selector) ·
         * bookmark ribbon (tags) · remaining header actions (history,
         * quick settings) · scenario-usage · auth-route key. The ribbon
         * deliberately sits in SECOND position, between the env selector
         * and the history button. */}
        {headerActionsLeading ? (
          <div className="restorm-workbench-tab-header-actions" data-testid={`${testIdPrefix}-header-actions-leading`}>
            {headerActionsLeading}
          </div>
        ) : null}
        {showBookmarks ? (
          <BookmarkRibbonStack
            bookmarks={ribbonBookmarks}
            onRename={handleRibbonRename}
            {...(onTagColorChange ? { onColorChange: handleRibbonColorChange } : {})}
            onRemove={handleRibbonRemove}
            onAdd={handleRibbonAdd}
            data-testid={`${testIdPrefix}-bookmarks`}
          />
        ) : null}
        {headerActions ? (
          <div className="restorm-workbench-tab-header-actions" data-testid={`${testIdPrefix}-header-actions`}>
            {headerActions}
          </div>
        ) : null}
        {/* "Used in scenarios" reverse-nav: flows in the cluster right after
         * the header actions, before the auth-route key. */}
        {topRightAction ? (
          <span
            className="restorm-workbench-tab-scenario-action"
            data-testid={`${testIdPrefix}-scenario-action`}
            onClick={(e) => { e.stopPropagation() }}
            onMouseDown={(e) => { e.stopPropagation() }}
          >
            {topRightAction}
          </span>
        ) : null}
        {/* Star-left action (e.g. the auth-route key selector): the
         * rightmost item of the cluster, so it flows snug after the env
         * pill / history / ribbon and lands immediately to the LEFT of
         * the favourite star — no fixed-width reserved slot, no gap. */}
        {starLeftAction ? (
          <span
            className="restorm-workbench-tab-star-left-action"
            data-testid={`${testIdPrefix}-star-left-action`}
            onClick={(e) => { e.stopPropagation() }}
            onMouseDown={(e) => { e.stopPropagation() }}
          >
            {starLeftAction}
          </span>
        ) : null}
      </div>
      {/* Row 1: ancestor breadcrumb — navigation only. The last segment
       * moved into the title row below, so edit / icon affordances are
       * disabled here (they live on the H1 + IconSelect). */}
      <div className="restorm-workbench-tab-breadcrumb-row">
        {ancestorBreadcrumbs.length > 0 ? (
          <Breadcrumb
            items={ancestorBreadcrumbs}
            canEditIcon={false}
            canEditName={false}
            allNavigable
            onItemClick={(item, index) => {
              onBreadcrumbClick?.(item, index, false)
            }}
            onItemAuxClick={(item, index) => {
              onBreadcrumbAuxClick?.(item, index, false)
            }}
            data-testid={`${testIdPrefix}-breadcrumb`}
          />
        ) : null}
      </div>
      {callout && (
        <div className="restorm-workbench-tab-callout">
          <Callout
            variant={callout.variant}
            message={callout.message}
            {...(callout.icon ? { icon: callout.icon } : {})}
            data-testid={`${testIdPrefix}-callout`}
          />
        </div>
      )}
      {/* Row 2: current-item icon + H1 name. Tags moved to the
       * top-right bookmark-ribbon stack. */}
      {onToggleFavorite ? (
        <span
          className="restorm-workbench-tab-favorite-star"
          onClick={(e) => { e.stopPropagation() }}
          onMouseDown={(e) => { e.stopPropagation() }}
        >
          <Toggle
            appearance="star"
            checked={Boolean(isFavorite)}
            aria-label={isFavorite ? t('sidebar.contextMenu.removeFromFavorites') : t('sidebar.contextMenu.addToFavorites')}
            data-testid={`${testIdPrefix}-favorite-toggle`}
            onChange={() => { onToggleFavorite() }}
          />
        </span>
      ) : null}
      <div className="restorm-workbench-tab-title-row">
        {lastItem?.icon != null ? (
          <IconSelect
            value={lastItem.icon}
            onChange={handleTitleIconChange}
            className="restorm-workbench-tab-title-icon-select"
            size={22}
            small={false}
            data-testid={`${testIdPrefix}-title-icon`}
          />
        ) : null}
        {lastItem ? (
          <EditableLabel
            as="h1"
            value={lastItem.label}
            onChange={handleTitleRename}
            editable={titleEditable}
            className="restorm-workbench-tab-title"
            data-testid={`${testIdPrefix}-title`}
          />
        ) : null}
        {headerRight}
      </div>
      {children}
    </div>
    </WorkbenchTabHostContext.Provider>
  )
}
