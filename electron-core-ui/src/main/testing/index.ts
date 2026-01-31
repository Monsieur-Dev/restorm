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
