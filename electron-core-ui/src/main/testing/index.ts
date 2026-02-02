export {
  installSystemModalsMocking,
  resetSystemModalsMockHistory,
  clearSystemModalsMockPending,
  getSystemModalsMockSnapshot,
  configureNextConfirmationDialog,
  configureNextOpenDialog,
  configureNextSaveFileDialog,
  configureNextSaveFolderDialog
} from './systemModalsMockMain'
export type {
  ConfirmationDialogConfig,
  OpenDialogMockConfig,
  SaveFileDialogMockConfig,
  SaveFolderDialogMockConfig
} from './systemModalsMockMain'

export {
  installSystemModalsMockingForE2E,
  resetSystemModalsMockHistoryForE2E,
  clearSystemModalsMockPendingForE2E,
  configureNextConfirmationDialogForE2E,
  configureNextOpenDialogForE2E,
  configureNextSaveFileDialogForE2E,
  configureNextSaveFolderDialogForE2E,
  getSystemModalsMockSnapshotForE2E
} from './systemModalsMockClient'
export type { ElectronAppLike } from './systemModalsMockClient'

export {
  breadcrumbRootSelector,
  breadcrumbLastLabelSelector,
  breadcrumbEditInputSelector,
  breadcrumbNonLastItemsSelector
} from './breadcrumbSelectors'

export {
  buttonTestIdSelector,
  buttonAnchorSelector,
  buttonDropdownToggleSelector,
  buttonDropdownPrimarySelector,
  buttonDropdownMenuSelector,
  buttonDropdownActionByIndexSelector
} from './buttonSelectors'

export {
  calloutTestIdSelector,
  calloutMessageSelector,
  calloutIconSelector
} from './calloutSelectors'

export {
  colorPickerTestIdSelector,
  colorPickerRootSelector,
  colorPickerHexInputSelector,
  colorPickerSaturationSelector,
  colorPickerHueSelector,
  colorPickerAlphaSelector
} from './colorPickerSelectors'

export {
  contextMenuRootSelector,
  contextMenuMenuSelector,
  contextMenuSeparatorSelector,
  contextMenuItemSelectorByLabel,
  contextMenuItemIconSelector,
  contextMenuSubmenuIndicatorSelector,
  contextMenuOpenSubmenuItemSelector,
  contextMenuOpenSubmenuContainerSelector,
  contextMenuOpenSubmenuItemByLabelSelector
} from './contextMenuSelectors'

export {
  customWcoRootSelector,
  customWcoSpacerSelector,
  customWcoMinimizeSelector,
  customWcoMaximizeSelector,
  customWcoCloseSelector,
  customWcoMaximizeIconSelector
} from './customWcoSelectors'

export {
  codeEditorRootSelector,
  codeEditorMonacoContainerSelector,
  codeEditorTextareaSelector,
  codeEditorResolvedThemeAttrSelector
} from './codeEditorSelectors'

export {
  inputBoxRootSelector,
  inputBoxContainerSelector,
  inputBoxInputSelector,
  inputBoxMessageSelector,
  inputBoxMirrorSelector
} from './inputBoxSelectors'

export {
  variableInputBoxRootSelector,
  variableInputBoxEditorSelector,
  variableInputBoxCodeEditorSelector,
  variableInputBoxTextareaSelector,
  variableInputBoxContextMenuSelector
} from './variableInputBoxSelectors'

export {
  keyValueTableRootSelector,
  keyValueTableTableSelector,
  keyValueTableRowSelector,
  keyValueTableRowKeyCellSelector,
  keyValueTableRowValueCellSelector,
  keyValueTableRowDescriptionCellSelector,
  keyValueTableRowEnabledToggleSelector,
  keyValueTableRowDeleteSelector,
  keyValueTableRowDragHandleSelector
} from './keyValueTableSelectors'

export { tooltipRootSelector, tooltipContentSelector } from './tooltipSelectors'

export {
  scrollableElementRootSelector,
  scrollableElementContentSelector,
  scrollableElementLeftShadowSelector,
  scrollableElementVerticalScrollbarSelector,
  scrollableElementVerticalSliderSelector,
  scrollableElementVerticalArrowUpSelector,
  scrollableElementVerticalArrowDownSelector,
  scrollableElementHorizontalScrollbarSelector,
  scrollableElementHorizontalSliderSelector,
  scrollableElementHorizontalArrowLeftSelector,
  scrollableElementHorizontalArrowRightSelector
} from './scrollableElementSelectors'

export {
  toggleRootSelector,
  toggleActionSelector,
  toggleLabelSelector,
  toggleIconSelector
} from './toggleSelectors'

export { radioGroupRootSelector, radioGroupItemSelector } from './radioSelectors'

export { progressBarRootSelector, progressBarBitSelector } from './progressBarSelectors'

export {
  sashRootSelector,
  verticalSashContainerRootSelector,
  verticalSashContainerLeftSelector,
  verticalSashContainerRightSelector,
  verticalSashContainerSashSelector,
  horizontalSashContainerRootSelector,
  horizontalSashContainerTopSelector,
  horizontalSashContainerBottomSelector,
  horizontalSashContainerSashSelector
} from './sashSelectors'

export {
  markdownViewerRootSelector,
  markdownViewerCodeBlockSelector,
  markdownViewerCodeBlockCopySelector,
  markdownViewerMermaidSelector,
  markdownViewerLinkSelector
} from './markdownViewerSelectors'
