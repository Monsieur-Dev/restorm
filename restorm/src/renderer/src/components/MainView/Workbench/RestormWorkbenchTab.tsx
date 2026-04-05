import React from 'react'
import * as CoreUIRenderer from 'electron-core-ui/renderer'
import { TagsView, Callout, type CalloutVariant } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type { BreadcrumbItem } from '../../../../../shared/types/editor'

const { Breadcrumb } = CoreUIRenderer as unknown as {
  Breadcrumb: React.ComponentType<{
    items: BreadcrumbItem[]
    onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
    onLastItemChange?: (item: BreadcrumbItem, newValue: string, index: number) => void
    onLastItemIconChange?: (item: BreadcrumbItem, newIcon: Icon | null, index: number) => void
    canEditIcon?: boolean
    canEditName?: boolean
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
  onBreadcrumbRename?: ((item: BreadcrumbItem, newValue: string) => void) | undefined
  onBreadcrumbIconChange?: ((item: BreadcrumbItem, newIcon: Icon | null) => void) | undefined
  tags: string[]
  onTagsChange?: ((nextTags: string[]) => void) | undefined
  label: string
  headerRight?: React.ReactNode
  tagsRight?: React.ReactNode
  /** Optional callout to display at the top of the tab */
  callout?: RestormWorkbenchTabCallout | undefined
  /** Optional tab ID for stable test IDs */
  tabId?: string
  children: React.ReactNode
}

export const RestormWorkbenchTab: React.FC<RestormWorkbenchTabProps> = ({
  breadcrumbs,
  onBreadcrumbClick,
  onBreadcrumbRename,
  onBreadcrumbIconChange,
  tags,
  onTagsChange,
  label,
  headerRight,
  tagsRight,
  callout,
  tabId,
  children
}) => {
  const testIdPrefix = tabId ? `tab-${tabId}` : 'workbench-tab'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: 'var(--editor-background)'
      }}
    >
      {callout && (
        <div style={{ padding: '8px 16px 0 16px' }}>
          <Callout
            variant={callout.variant}
            message={callout.message}
            {...(callout.icon ? { icon: callout.icon } : {})}
            data-testid={`${testIdPrefix}-callout`}
          />
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px 0 16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span
            style={{
              color: 'var(--descriptionForeground)'
            }}
          >
            {label}
          </span>
          <TagsView
            tags={tags}
            onChange={(nextTags) => {
              onTagsChange?.(nextTags)
            }}
            data-testid={`${testIdPrefix}-tags`}
          />
        </div>
        {tagsRight}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px 0 16px'
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Breadcrumb
            items={breadcrumbs}
            canEditIcon
            canEditName
            onItemClick={(item, index) => {
              const isLast = index === breadcrumbs.length - 1
              onBreadcrumbClick?.(item, index, isLast)
            }}
            onLastItemChange={(item, newValue) => {
              onBreadcrumbRename?.(item, newValue)
            }}
            onLastItemIconChange={(item, newIcon) => {
              onBreadcrumbIconChange?.(item, newIcon)
            }}
            data-testid={`${testIdPrefix}-breadcrumb`}
          />
        </div>
        {headerRight}
      </div>
        {children}
    </div>
  )
}

export default RestormWorkbenchTab
