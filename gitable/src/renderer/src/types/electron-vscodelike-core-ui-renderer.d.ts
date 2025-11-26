import type React from 'react'

declare module 'electron-core-ui/renderer' {
  /**
   * Extend EditorTab with optional titleString (for serialization) to match
   * the implementation in electron-core-ui.
   */
  interface EditorTab {
    /**
     * String representation of the title for serialization purposes.
     */
    titleString?: string
  }

  export type ListViewSelectionMode = 'single' | 'multiple'
  export type ListViewDropPosition = 'before' | 'after' | 'into'

  export interface ListViewItemData {
    id: string
    title?: React.ReactNode
    icon?: React.ReactNode | string
    children?: ListViewItemData[]
    isExpanded?: boolean
    /**
     * When true, the item should display an expander/chevron even if it has no children.
     */
    isExpandable?: boolean
    isSelectable?: boolean
    isStickyHeader?: boolean
    data?: unknown
  }

  export interface ListViewItemPath {
    ids: string[]
    indices: number[]
  }

  export interface ListViewItemEventPayload {
    item: ListViewItemData
    path: ListViewItemPath
  }

  export interface ListViewDropEventPayload extends ListViewItemEventPayload {
    source: ListViewItemData
    sourcePath: ListViewItemPath
    position: ListViewDropPosition
    originalEvent: React.DragEvent<HTMLDivElement>
  }

  export interface ListViewProps {
    items?: ListViewItemData[]
    children?: React.ReactNode
    className?: string
    style?: React.CSSProperties
    selectedIds?: string[]
    activeId?: string | null
    selectionMode?: ListViewSelectionMode
    rootRole?: 'list' | 'tree'
    ariaLabel?: string
    onItemClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
    onItemDoubleClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
    onSelectionChange?: (selectedIds: string[], payload: ListViewItemEventPayload) => void
    onItemToggle?: (
      payload: ListViewItemEventPayload,
      expanded: boolean,
      event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>
    ) => void
    onItemDrop?: (payload: ListViewDropEventPayload) => void
    onItemContextMenu?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  }

  export const ListView: React.FC<ListViewProps>

  export interface ListViewItemProps {
    id?: string
    title?: React.ReactNode
    icon?: React.ReactNode | string
    isExpanded?: boolean
    /**
     * Force the item to show an expander/chevron even if it has no children.
     */
    isExpandable?: boolean
    isSelectable?: boolean
    isStickyHeader?: boolean
    data?: unknown
    children?: React.ReactNode
  }

  export const ListViewItem: React.FC<ListViewItemProps>

  export type SashOrientation = 'vertical' | 'horizontal'
  export type SashState = 'enabled' | 'disabled' | 'atMinimum' | 'atMaximum'

  export interface SashEvent {
    readonly startX: number
    readonly currentX: number
    readonly startY: number
    readonly currentY: number
    readonly altKey: boolean
  }

  export interface IVerticalSashLayoutProvider {
    getVerticalSashLeft(sash: { orientation: SashOrientation }): number
    getVerticalSashTop?(sash: { orientation: SashOrientation }): number
    getVerticalSashHeight?(sash: { orientation: SashOrientation }): number
  }

  export interface SashProps {
    orientation: SashOrientation
    layoutProvider: IVerticalSashLayoutProvider
    state?: SashState
    size?: number
    hoverDelay?: number
    onStart?: (event: SashEvent) => void
    onChange?: (event: SashEvent) => void
    onEnd?: () => void
    onReset?: () => void
    className?: string
  }

  export const Sash: React.FC<SashProps>
}


