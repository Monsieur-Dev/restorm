import React from 'react'
import * as CoreUIRenderer from 'electron-core-ui/renderer'
import { TagsView } from 'electron-core-ui/renderer'
import type { BreadcrumbItem } from '../types/editor'

const { Breadcrumb } = CoreUIRenderer as unknown as {
  Breadcrumb: React.ComponentType<{
    items: BreadcrumbItem[]
    onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
    onLastItemChange?: (item: BreadcrumbItem, newValue: string, index: number) => void
  }>
}

export interface WorkbenchTabProps {
  breadcrumbs: BreadcrumbItem[]
  onBreadcrumbClick?: ((item: BreadcrumbItem, index: number, isLast: boolean) => void) | undefined
  onBreadcrumbRename?: ((item: BreadcrumbItem, newValue: string) => void) | undefined
  tags: string[]
  onTagsChange?: (nextTags: string[]) => void
  label: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}

export const WorkbenchTab: React.FC<WorkbenchTabProps> = ({
  breadcrumbs,
  onBreadcrumbClick,
  onBreadcrumbRename,
  tags,
  onTagsChange,
  label,
  headerRight,
  children
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: 'var(--vscode-editor-background)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px 0 16px'
        }}
      >
        <span
          style={{
            color: 'var(--vscode-descriptionForeground)'
          }}
        >
          {label}
        </span>
        <TagsView
          tags={tags}
          onChange={(nextTags) => {
            onTagsChange?.(nextTags)
          }}
        />
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
            onItemClick={(item, index) => {
              const isLast = index === breadcrumbs.length - 1
              onBreadcrumbClick?.(item, index, isLast)
            }}
            onLastItemChange={(item, newValue) => {
              onBreadcrumbRename?.(item, newValue)
            }}
          />
        </div>
        {headerRight}
      </div>
        {children}
    </div>
  )
}

export default WorkbenchTab
