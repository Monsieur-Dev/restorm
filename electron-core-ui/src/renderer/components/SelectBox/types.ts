import React from 'react'

// Note: Event and IDisposable are not available in React context
// These are kept for interface compatibility
type Event<T> = (listener: (e: T) => void) => void
interface IDisposable {
  dispose(): void
}

// SelectBox delegate interface
export interface ISelectBoxDelegate extends IDisposable {
  readonly onDidSelect: Event<ISelectData>
  setOptions(options: ISelectOptionItem[], selected?: number): void
  select(index: number): void
  setAriaLabel(label: string): void
  focus(): void
  blur(): void
  setFocusable(focus: boolean): void
  setEnabled(enabled: boolean): void
  render(container: HTMLElement): void
}

// SelectBox options interface
export interface ISelectBoxOptions {
  useCustomDrawn?: boolean
  ariaLabel?: string
  ariaDescription?: string
  minBottomMargin?: number
  optionsAsChildren?: boolean
}

// Select option item interface
export interface ISelectOptionItem {
  /**
   * Underlying string value of the option.
   * Used for native selects and serialization.
   */
  text: string
  /**
   * Optional React label rendered in the custom dropdown and trigger.
   * Falls back to `text` when not provided.
   */
  label?: React.ReactNode
  /**
   * Optional detail text or React node shown next to the main label.
   */
  detail?: React.ReactNode
  /**
   * Optional decorator rendered on the right side of the option row.
   */
  decoratorRight?: React.ReactNode
  /**
   * Optional description rendered in the details pane below the list.
   */
  description?: React.ReactNode
  descriptionIsMarkdown?: boolean
  readonly descriptionMarkdownActionHandler?: (href: string) => void // MarkdownActionHandler type
  isDisabled?: boolean
}

// SelectBox styles interface
export interface ISelectBoxStyles {
  readonly selectBackground: string | undefined
  readonly selectListBackground: string | undefined
  readonly selectForeground: string | undefined
  readonly decoratorRightForeground: string | undefined
  readonly selectBorder: string | undefined
  readonly selectListBorder: string | undefined
  readonly focusBorder: string | undefined
  readonly listFocusBackground: string | undefined
  readonly listFocusForeground: string | undefined
  readonly listHoverBackground: string | undefined
  readonly listHoverForeground: string | undefined
  readonly listFocusOutline: string | undefined
  readonly listHoverOutline: string | undefined
}

// Select data interface
export interface ISelectData {
  selected: string
  index: number
}

// Default SelectBox styles
export const defaultSelectBoxStyles: ISelectBoxStyles = {
  selectBackground: 'var(--settings-dropdownBackground)',
  selectListBackground: 'var(--editor-background)',
  selectForeground: 'var(--settings-dropdownForeground)',
  decoratorRightForeground: 'var(--descriptionForeground)',
  selectBorder: 'var(--settings-dropdownBorder)',
  selectListBorder: 'var(--panel-border)',
  focusBorder: 'var(--focusBorder)',
  listFocusBackground: 'var(--list-activeSelectionBackground)',
  listFocusForeground: 'var(--list-activeSelectionForeground)',
  listHoverBackground: 'var(--list-hoverBackground)',
  listHoverForeground: 'var(--list-hoverForeground)',
  listFocusOutline: 'var(--focusBorder)',
  listHoverOutline: 'var(--list-hoverBackground)'
}

// React props interface for SelectBox component
export interface SelectBoxProps {
  options: ISelectOptionItem[]
  selected?: number
  onDidSelect?: (data: ISelectData) => void
  selectBoxOptions?: ISelectBoxOptions
  styles?: ISelectBoxStyles
  className: string
  id: string
  /** Optional test id applied to the root element. */
  'data-testid'?: string
  /**
   * Item count at or above which a sticky filter row appears at the
   * top of the popup. Default: `15` (`DEFAULT_FILTER_THRESHOLD`).
   * Pass a large value to opt out per-instance.
   */
  filterThreshold?: number
  /** Localised placeholder for the filter input. */
  filterPlaceholder?: string
  /** Optional test id forwarded to the filter row. */
  filterTestId?: string
  /** When true, the control is locked: greyed out, closed, and inert to
   * pointer + keyboard input (no dropdown open, no selection change). */
  disabled?: boolean
}

// React props interface for SelectBoxList component
export interface SelectBoxListProps {
  options: ISelectOptionItem[]
  selected: number
  onDidSelect: (data: ISelectData) => void
  selectBoxOptions: ISelectBoxOptions
  styles: ISelectBoxStyles
  className: string
  id: string
  'data-testid'?: string
  filterThreshold?: number
  filterPlaceholder?: string
  filterTestId?: string
  disabled?: boolean
}

// React props interface for SelectBoxNative component
export interface SelectBoxNativeProps {
  options: ISelectOptionItem[]
  selected: number
  onDidSelect: (data: ISelectData) => void
  selectBoxOptions: ISelectBoxOptions
  styles: ISelectBoxStyles
  className: string
  id: string
  'data-testid'?: string
  disabled?: boolean
}
