import CustomDropdown from './CustomDropdown'
import Tabs from './Tabs'
import { SettingsTreeView } from './SettingsTreeView'
import MonacoWorkbench from './MonacoWorkbench'
import ElectronCoreUiProvider from './ElectronCoreUiProvider'
import { EditorWorkbench } from './Workbench/EditorWorkbench'
import { MarkdownEditor } from './MarkdownEditor/MarkdownEditor'
import { MarkdownViewer } from './MarkdownViewer/MarkdownViewer'
import { SplitView, Pane } from './SplitView'

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
export type { IToggleStyles, ICheckboxStyles, ToggleProps } from './Toggle/index'

// Radio exports
export { RadioGroup, defaultRadioStyles } from './Radio/index'
export type { IRadioStyles, IRadioOptionItem, IRadioOptions, RadioGroupProps } from './Radio/index'

// ProgressBar exports
export { ProgressBar, defaultProgressBarStyles } from './ProgressBar/index'
export type { IProgressBarStyles, IProgressBarOptions, ProgressBarProps } from './ProgressBar/index'

// ScrollableElement exports
export { ScrollableElement, defaultScrollableElementStyles } from './ScrollableElement/index'
export type { IScrollableElementStyles, IScrollableElementOptions, ScrollableElementProps } from './ScrollableElement/index'

// Sash exports
export { Sash } from './Sash'
export type {
  SashOrientation,
  SashState,
  SashEvent,
  IVerticalSashLayoutProvider,
  IHorizontalSashLayoutProvider,
  SashLayoutProvider,
  SashProps
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

// Breadcrumb exports
export { Breadcrumb } from './Breadcrumb'
export type { BreadcrumbProps, BreadcrumbItem } from './Breadcrumb'

// TagsView exports
export { TagsView } from './TagsView/TagsView'
export type { TagsViewProps } from './TagsView/TagsView'

// IconSelect exports
export { IconSelect } from './IconSelect'
export type { IconSelectProps } from './IconSelect'

// Button exports
export { Button, ButtonWithDescription, ButtonWithDropdown, ButtonWithIcon, defaultButtonStyles } from './Button/index'
export type { IButtonOptions, IButtonStyles, IButtonWithDropdownOptions, ButtonProps, ButtonWithDescriptionProps, ButtonWithDropdownProps, ButtonWithIconProps } from './Button/index'

// SelectBox exports
export { SelectBox, SelectBoxNative, SelectBoxList, defaultSelectBoxStyles } from './SelectBox/index'
export type { ISelectBoxDelegate, ISelectBoxOptions, ISelectOptionItem, ISelectBoxStyles, ISelectData, SelectBoxProps, SelectBoxNativeProps, SelectBoxListProps } from './SelectBox/index'

// MenuBar exports
export { MenuBar, MenuBarItem, MenuItem, MenuItemSeparator } from './MenuBar/index'
export type { MenuBarProps, MenuItemProps, MenuItemSeparatorProps, MenuBarState, MenuItemState } from './MenuBar/index'

// Titlebar exports
export { Titlebar } from './Titlebar/index'
export type { TitlebarProps } from './Titlebar/index'

// Statusbar exports
export { Statusbar, StatusbarElement } from './Statusbar/index'
export type { StatusbarProps, StatusbarElementProps } from './Statusbar/index'

// Tooltip exports
export { Tooltip } from './Tooltip/index'
export type { TooltipProps } from './Tooltip/index'

// ContextMenu exports
export { ContextMenu } from './ContextMenu/ContextMenu'
export type { ContextMenuProps, ContextMenuItem } from './ContextMenu/ContextMenu'

// InputTable exports
export { InputTable } from './InputTable'
export type { InputTableProps, InputTableColumn, InputTableRow, InputTableColumnType } from './InputTable'

// CustomWCO exports
export { CustomWCO } from './CustomWCO/index'
export type { CustomWCOProps } from './CustomWCO/index'

// Other exports
export {
  CustomDropdown,
  Tabs,
  SettingsTreeView,
  MonacoWorkbench,
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
export type { MonacoWorkbenchProps } from './MonacoWorkbench'
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

// Workbench IPC exports
export { onWorkbenchTabDropped } from './Workbench/ipc'

// Workbench tree functions exports
export { insertTabAt, normalizeTree, removeTab, findGroup } from './Workbench/tree'
export type { FindResult } from './Workbench/tree'
export { isTabGroupNode, isContainerNode } from './Workbench/types'
export { getTabTitleString, extractTextFromReactNode } from './Workbench/utils'

