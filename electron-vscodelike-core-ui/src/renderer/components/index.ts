import CustomDropdown from './CustomDropdown'
import CustomTabs from './CustomTabs'
import { SettingsTreeView } from './SettingsTreeView'
import MonacoWorkbench from './MonacoWorkbench'
import { EditorWorkbench } from './Workbench/EditorWorkbench'

// InputBox exports
export { InputBox, MessageType } from './InputBox'
export type { IInputOptions, IInputBoxStyles, IMessage, IInputValidator, IInputValidationOptions, IRange, InputBoxProps } from './InputBox'

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

// CustomWCO exports
export { CustomWCO } from './CustomWCO/index'
export type { CustomWCOProps } from './CustomWCO/index'

// Other exports
export { CustomDropdown, CustomTabs, SettingsTreeView, MonacoWorkbench, EditorWorkbench }
export type { Tab } from './CustomTabs'
export type { MonacoWorkbenchProps } from './MonacoWorkbench'
export type { EditorWorkbenchProps } from './Workbench/EditorWorkbench'
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

