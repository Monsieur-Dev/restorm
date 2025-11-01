// Note: Event and IDisposable are not available in React context
// These are kept for interface compatibility with VSCode
type Event<T> = (listener: (e: T) => void) => void
interface IDisposable {
  dispose(): void
}

// SelectBox delegate interface - matches VSCode implementation
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

// Select option item interface - matches VSCode implementation
export interface ISelectOptionItem {
  text: string
  detail?: string
  decoratorRight?: string
  description?: string
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
  selectBackground: 'var(--vscode-settings-dropdownBackground)',
  selectListBackground: 'var(--vscode-editor-background)',
  selectForeground: 'var(--vscode-settings-dropdownForeground)',
  decoratorRightForeground: 'var(--vscode-descriptionForeground)',
  selectBorder: 'var(--vscode-settings-dropdownBorder)',
  selectListBorder: 'var(--vscode-panel-border)',
  focusBorder: 'var(--vscode-focusBorder)',
  listFocusBackground: 'var(--vscode-list-activeSelectionBackground)',
  listFocusForeground: 'var(--vscode-list-activeSelectionForeground)',
  listHoverBackground: 'var(--vscode-list-hoverBackground)',
  listHoverForeground: 'var(--vscode-list-hoverForeground)',
  listFocusOutline: 'var(--vscode-focusBorder)',
  listHoverOutline: 'var(--vscode-list-hoverBackground)'
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
}
