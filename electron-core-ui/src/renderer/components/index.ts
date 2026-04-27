import CustomDropdown from './CustomDropdown'
import Tabs from './Tabs'
import Workbench from './Workbench/Workbench'
import ElectronCoreUiProvider from './ElectronCoreUiProvider'
import { EditorWorkbench } from './Workbench/EditorWorkbench'
import { MarkdownEditor } from './MarkdownEditor/MarkdownEditor'
import { MarkdownViewer } from './MarkdownViewer/MarkdownViewer'
import { SplitView, Pane } from './SplitView'

// ControlGroup exports
export { ControlGroup } from './ControlGroup'
export type { ControlGroupProps, ControlGroupOrientation } from './ControlGroup'

// Callout exports
export { Callout } from './Callout'
export type { CalloutProps, CalloutVariant } from './Callout'

export { DropdownFilterRow } from './DropdownFilterRow'
export type { DropdownFilterRowProps } from './DropdownFilterRow'

// InputBox exports
export { InputBox, MessageType } from './InputBox'
export type {
  IInputOptions,
  IInputBoxStyles,
  IMessage,
  IInputValidator,
  IInputValidationOptions,
  IRange,
  InputBoxProps
} from './InputBox'

// DateTimePicker exports
export { DateTimePicker } from './DateTimePicker'
export type { DateTimePickerProps } from './DateTimePicker'

// VariableInputBox exports
export { VariableInputBox } from './VariableInputBox'
export type { VariableInputBoxProps, VariableDefinition } from './VariableInputBox'

// CodeEditor exports
export { CodeEditor } from './CodeEditor'
export type { CodeEditorProps, CodeEditorRef } from './CodeEditor'

// Settings exports
export { SettingsPage, SettingsModalProvider, useSettingsModal } from './Settings'

// Toggle exports
export { Toggle, defaultToggleStyles } from './Toggle/index'
export type { IToggleStyles, ICheckboxStyles, ToggleProps, ToggleState, ToggleValue } from './Toggle/index'

// Radio exports
export { RadioGroup, defaultRadioStyles } from './Radio/index'
export type { IRadioStyles, IRadioOptionItem, IRadioOptions, RadioGroupProps } from './Radio/index'

// ProgressBar exports
export { ProgressBar, defaultProgressBarStyles } from './ProgressBar/index'
export type { IProgressBarStyles, IProgressBarOptions, ProgressBarProps } from './ProgressBar/index'

// ScrollableElement exports
export { ScrollableElement, defaultScrollableElementStyles } from './ScrollableElement/index'
export type { IScrollableElementStyles, IScrollableElementOptions, ScrollableElementProps } from './ScrollableElement/index'

// ColorPicker exports
export { ColorPicker } from './ColorPicker'
export type { ColorPickerProps } from './ColorPicker'

// Sash exports
export { VerticalSashContainer, HorizontalSashContainer } from './Sash'
export type {
  SashOrientation,
  SashState,
  SashEvent,
  IVerticalSashLayoutProvider,
  IHorizontalSashLayoutProvider,
  SashLayoutProvider,
  SashConfig,
  VerticalSashContainerProps,
  HorizontalSashContainerProps
} from './Sash'

// ListView exports
export { ListView, ListViewItem } from './ListView'
export type {
  ListViewProps,
  ListViewItemProps,
  ListViewItemData,
  ListViewItemEventPayload,
  ListViewDropEventPayload,
  ListViewItemPath,
  ListViewSelectionMode,
  ListViewDropPosition
} from './ListView'

// ListViewDropdown exports
export { ListViewDropdown } from './ListViewDropdown/ListViewDropdown'
export type { ListViewDropdownProps } from './ListViewDropdown/ListViewDropdown'

// Breadcrumb exports
export { Breadcrumb } from './Breadcrumb'
export type { BreadcrumbProps, BreadcrumbItem } from './Breadcrumb'

// EditableLabel exports
export { EditableLabel } from './EditableLabel'
export type { EditableLabelAs, EditableLabelProps } from './EditableLabel'

// BookmarkRibbon exports
export { BookmarkRibbon, BookmarkRibbonStack } from './BookmarkRibbon'
export type { BookmarkRibbonProps, BookmarkRibbonStackProps, Bookmark } from './BookmarkRibbon'

// Tag exports
export { Tag } from './Tag'
export type { TagProps } from './Tag'

// TagsView exports
export { TagsView } from './TagsView/TagsView'
export type { TagsViewProps } from './TagsView/TagsView'

// IconView exports
export { IconView } from './IconView'
export type { IconViewProps } from './IconView'

// JsonViewer exports
export { JsonViewer } from './JsonViewer'
export type { JsonViewerProps } from './JsonViewer'

// TabSwitcherOverlay exports
export { TabSwitcherOverlay } from './TabSwitcherOverlay'
export type { TabSwitcherOverlayProps, TabSwitcherItem } from './TabSwitcherOverlay'

// IconSelect exports
export { IconSelect, RenderLibraryIcon, IconoirIcon, PhosphorIcon, MdiIcon, SimpleIcon, ICON_LIBRARIES } from './IconSelect'
export type { IconSelectProps, IconLibrary } from './IconSelect'

// Button exports
export { Button, ButtonWithDescription, ButtonWithDropdown, ButtonWithIcon, defaultButtonStyles } from './Button/index'
export type { IButtonOptions, IButtonStyles, IButtonWithDropdownOptions, ButtonProps, ButtonWithDescriptionProps, ButtonWithDropdownProps, ButtonWithIconProps } from './Button/index'

// SelectBox exports
export { SelectBox, SelectBoxNative, SelectBoxList, defaultSelectBoxStyles } from './SelectBox/index'
export type { ISelectBoxDelegate, ISelectBoxOptions, ISelectOptionItem, ISelectBoxStyles, ISelectData, SelectBoxProps, SelectBoxNativeProps, SelectBoxListProps } from './SelectBox/index'

// MultiSelectCombo exports
export { MultiSelectCombo } from './MultiSelectCombo/MultiSelectCombo'
export type { MultiSelectComboOption, MultiSelectComboProps } from './MultiSelectCombo/MultiSelectCombo'

// MenuBar exports
export { MenuBar, MenuBarItem, MenuItem, MenuItemSeparator } from './MenuBar/index'
export type { MenuBarProps, MenuItemProps, MenuItemSeparatorProps, MenuBarState, MenuItemState } from './MenuBar/index'

// Titlebar exports
export { Titlebar } from './Titlebar/index'
export type { TitlebarProps } from './Titlebar/index'

// SearchBar exports
export { SearchBar } from './SearchBar/index'
export type { SearchBarProps } from './SearchBar/index'

// Statusbar exports
export { Statusbar, StatusbarElement } from './Statusbar/index'
export type { StatusbarProps, StatusbarElementProps } from './Statusbar/index'

// Tooltip exports
export { Tooltip } from './Tooltip/index'
export type { TooltipProps } from './Tooltip/index'

// ContextMenu exports
export { ContextMenu } from './ContextMenu/ContextMenu'
export type { ContextMenuProps, ContextMenuItem } from './ContextMenu/ContextMenu'

// KeyValueTable exports
export { KeyValueTable } from './KeyValueTable/KeyValueTable'
export type {
  KeyValueTableProps,
  KeyValueTableHandle,
  KeyValueTableRow,
  CellRendererProps
} from './KeyValueTable/KeyValueTable'

// Table exports
export { Table } from './Table/Table'
export type { TableColumn, TableProps, TableHandle } from './Table/Table'

// Toaster exports
export { Toaster, toasterService, useToasts, StatusBarBellButton } from './Toaster/index'
export type {
  ToasterPosition,
  ToasterOrder,
  ScrollDismissBehavior,
  ToastInput,
  Toast,
  AnimationDurations,
  ToasterProps,
  ToasterEvent,
  StatusBarBellButtonProps
} from './Toaster/index'

// CustomWCO exports
export { CustomWCO } from './CustomWCO/index'
export type { CustomWCOProps } from './CustomWCO/index'

// Other exports
export {
  CustomDropdown,
  Tabs,
  Workbench,
  EditorWorkbench,
  MarkdownEditor,
  MarkdownViewer,
  SplitView,
  Pane,
  ElectronCoreUiProvider
}
export type { Tab, TabsProps } from './Tabs'
export { Modal } from './Modal'
export type { ModalProps } from './Modal'
export type { MarkdownEditorProps } from './MarkdownEditor/MarkdownEditor'
export type { MarkdownViewerProps } from './MarkdownViewer/MarkdownViewer'
export type { WorkbenchProps } from './Workbench/Workbench'
export type { ElectronCoreUiProviderProps } from './ElectronCoreUiProvider'
export type { EditorWorkbenchProps, EditorWorkbenchHandle } from './Workbench/EditorWorkbench'

// Workbench persistence exports
export {
	extractWorkbenchState,
	rebuildWorkbenchTree,
	saveWorkbenchState,
	loadWorkbenchState,
	clearWorkbenchState
} from './Workbench/persistence'
export type {
	PersistedGroupNode,
	PersistedWorkbenchState,
	RebuildTabCallback
} from './Workbench/persistence'
export type {
	SplitViewOrientation,
	SplitViewProps,
	SplitViewPaneProps
} from './SplitView'

// StaticPane — non-collapsible / auto-height panel mirroring the
// visual style of SplitView's Pane, rendered in natural document
// flow (stack children freely, each sizes to content).
export { StaticPane } from './StaticPane'
export type { StaticPaneProps } from './StaticPane'
export type {
	WorkbenchState, // legacy flat types (kept for external imports)
	EditorGroup,
	EditorTab,
	EditorWorkbenchCallbacks,
	SplitDirection,
	Orientation,
	WorkbenchTree,
	GroupNode,
	TabGroupNode
} from './Workbench/types'

// Lazy-loaded component exports (for code splitting)
export { LazyCodeEditor, LazyMarkdownEditor, LazyMarkdownViewer } from './lazy'

// Workbench IPC exports
export { onWorkbenchTabDropped } from './Workbench/ipc'

// Workbench tree functions exports
export { insertTabAt, normalizeTree, removeTab, findGroup } from './Workbench/tree'
export type { FindResult } from './Workbench/tree'
export { isTabGroupNode, isContainerNode } from './Workbench/types'
export { getTabTitleString, extractTextFromReactNode } from './Workbench/utils'
