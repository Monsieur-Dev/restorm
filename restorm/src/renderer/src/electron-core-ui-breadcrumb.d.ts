import type * as React from 'react'

// Local augmentation so restorm can consume the Breadcrumb component
// before the new types are published in the electron-core-ui package.
declare module 'electron-core-ui/renderer' {
  export interface BreadcrumbItem {
    id: string
    label: string
  }

  export interface BreadcrumbProps {
    items: BreadcrumbItem[]
    onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
    onLastItemChange?: (value: string, index: number) => void
    className?: string
    style?: React.CSSProperties
    ariaLabel?: string
  }

  export const Breadcrumb: React.FC<BreadcrumbProps>
}
