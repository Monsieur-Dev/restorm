import React, { useCallback } from 'react'
import * as CoreUIRenderer from 'electron-core-ui/renderer'
import { Callout, EditableLabel, IconSelect, BookmarkRibbonStack, type BookmarkRibbonTag, type CalloutVariant } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import './restormWorkbenchTab.css'

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
  /** Optional callout to display at the top of the tab */
  callout?: RestormWorkbenchTabCallout | undefined
  /** Optional tab ID for stable test IDs */
  tabId?: string
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
  callout,
  tabId,
  children
}) => {
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

  const ribbonTags: BookmarkRibbonTag[] = tags.map((t) => {
    const col = tagColors?.[t]
    return col !== undefined ? { label: t, color: col } : { label: t }
  })

  const handleRibbonRename = useCallback((index: number, next: string) => {
    const nextTags = [...tags]
    nextTags[index] = next
    onTagsChange?.(nextTags)
  }, [tags, onTagsChange])

  const handleRibbonColorChange = useCallback((index: number, hex: string | null) => {
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
    <div className="restorm-workbench-tab">
      {/* Bookmark-ribbon tags anchored to the top-right of the tab's
       * positioned root. Replaces the old inline `TagsView` cluster. */}
      <BookmarkRibbonStack
        tags={ribbonTags}
        onRename={handleRibbonRename}
        {...(onTagColorChange ? { onColorChange: handleRibbonColorChange } : {})}
        onRemove={handleRibbonRemove}
        onAdd={handleRibbonAdd}
        data-testid={`${testIdPrefix}-tag-ribbons`}
      />
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
      {/* Row 2: current-item icon + H1 name. Tags moved to the
       * top-right bookmark-ribbon stack. */}
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
            className="restorm-workbench-tab-title"
            data-testid={`${testIdPrefix}-title`}
          />
        ) : null}
        {headerRight}
      </div>
      {children}
    </div>
  )
}

export default RestormWorkbenchTab
