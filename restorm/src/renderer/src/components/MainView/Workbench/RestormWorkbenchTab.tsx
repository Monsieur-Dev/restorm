import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as CoreUIRenderer from 'electron-core-ui/renderer'
import { TagsView, Tag, Callout, ColorPicker, Tooltip, EditableLabel, IconSelect, type CalloutVariant, type ContextMenuItem } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

  // Split the breadcrumb path: ancestors stay in the navigation row,
  // the last (current) item gets promoted to its own H1 title row
  // below. This matches the common "path > heading" layout in modern
  // editors and keeps the title visually prominent.
  const lastItem = breadcrumbs[breadcrumbs.length - 1]
  const ancestorBreadcrumbs = breadcrumbs.slice(0, -1)

  // Color picker state
  const [colorPickerTag, setColorPickerTag] = useState<string | null>(null)
  const colorPickerTargetRef = useRef<HTMLElement | null>(null)
  const tooltipClassName = 'restorm-tag-color-picker-tooltip'

  // Close color picker on outside mousedown
  useEffect(() => {
    if (!colorPickerTag) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return

      // Ignore clicks on the tag target element
      if (colorPickerTargetRef.current?.contains(target)) return

      // Ignore clicks inside the tooltip
      const tooltipEl = document.querySelector(`.${tooltipClassName}`)
      if (tooltipEl?.contains(target)) return

      setColorPickerTag(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [colorPickerTag])

  const newTagLabel = t('tagsView.newTag', 'New tag')

  const handleRenderTag = useCallback(
    (tag: string, index: number, handlers: { onClick: () => void; onContextMenu: (e: React.MouseEvent) => void }) => {
      const color = tagColors?.[tag]
      const isNew = tag === newTagLabel
      return (
        <Tag
          label={tag}
          color={color}
          editable
          startEditing={isNew}
          onLabelChange={(newLabel) => {
            const nextTags = [...tags]
            nextTags[index] = newLabel
            onTagsChange?.(nextTags)
          }}
          onRemove={() => {
            const nextTags = tags.filter((_t, i) => i !== index)
            onTagsChange?.(nextTags)
          }}
          onContextMenu={(e) => {
            colorPickerTargetRef.current = e.currentTarget as HTMLElement
            handlers.onContextMenu(e)
          }}
          data-testid={`${testIdPrefix}-tag-${index}`}
        />
      )
    },
    [tagColors, testIdPrefix, tags, onTagsChange, newTagLabel]
  )

  const handleAdditionalContextMenuItems = useCallback(
    (tag: string, _index: number): ContextMenuItem[] => {
      if (!onTagColorChange) return []
      const hasColor = !!tagColors?.[tag]
      const items: ContextMenuItem[] = [
        {
          id: 'change-tag-color',
          label: t('tagsView.changeColor', 'Change tag color...'),
          icon: 'symbol-color',
          onClick: () => {
            setColorPickerTag(tag)
          }
        }
      ]
      if (hasColor) {
        items.push({
          id: 'remove-tag-color',
          label: t('tagsView.removeColor', 'Remove tag color'),
          icon: 'close',
          onClick: () => {
            onTagColorChange(tag, null)
          }
        })
      }
      return items
    },
    [onTagColorChange, tagColors, t]
  )

  const handleColorPickerChange = useCallback(
    (hex: string) => {
      if (colorPickerTag) {
        onTagColorChange?.(colorPickerTag, hex)
      }
    },
    [colorPickerTag, onTagColorChange]
  )

  const handleTitleRename = useCallback((next: string) => {
    if (!lastItem) return
    onBreadcrumbRename?.(lastItem, next)
  }, [lastItem, onBreadcrumbRename])

  const handleTitleIconChange = useCallback((next: Icon | null) => {
    if (!lastItem) return
    onBreadcrumbIconChange?.(lastItem, next)
  }, [lastItem, onBreadcrumbIconChange])

  return (
    <div className="restorm-workbench-tab">
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
              // Treat every ancestor click as a non-terminal
              // navigation — the current page is rendered as an H1
              // below, so no ancestor is ever "the last item" from
              // the consumer's point of view.
              onBreadcrumbClick?.(item, index, false)
            }}
            onItemAuxClick={(item, index) => {
              onBreadcrumbAuxClick?.(item, index, false)
            }}
            data-testid={`${testIdPrefix}-breadcrumb`}
          />
        ) : null}
      </div>
      {/* Row 2: current-item icon + H1 name + tags pushed right. */}
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
        <div className="restorm-workbench-tab-tags">
          <span className="restorm-workbench-tab-tags-label">
            {t('workbench.tagsLabel')}
          </span>
          <TagsView
            tags={tags}
            onChange={(nextTags) => {
              onTagsChange?.(nextTags)
            }}
            renderTag={handleRenderTag}
            additionalContextMenuItems={onTagColorChange ? handleAdditionalContextMenuItems : undefined}
            data-testid={`${testIdPrefix}-tags`}
          />
          {headerRight}
        </div>
      </div>
      {children}

      {/* Color picker tooltip */}
      <Tooltip
        targetRef={colorPickerTargetRef as unknown as React.RefObject<HTMLElement | null>}
        show={colorPickerTag !== null}
        placement="below"
        className={tooltipClassName}
        data-testid={`${testIdPrefix}-color-picker-tooltip`}
        content={
          <div onMouseDown={(e) => { e.stopPropagation() }}>
            <ColorPicker
              value={colorPickerTag ? (tagColors?.[colorPickerTag] ?? '#3498db') : '#3498db'}
              onChange={handleColorPickerChange}
              disableAlpha
              data-testid={`${testIdPrefix}-color-picker`}
            />
          </div>
        }
      />
    </div>
  )
}

export default RestormWorkbenchTab
