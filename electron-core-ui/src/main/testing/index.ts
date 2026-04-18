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
  modalRootSelector,
  modalOverlaySelector,
  modalHeaderSelector,
  modalTitleSelector,
  modalBodySelector,
  modalCloseButtonTestId,
  modalCloseButtonSelector
} from './modalSelectors'

export {
  titlebarRootSelector,
  titlebarLeftSelector,
  titlebarCenterSelector,
  titlebarRightSelector,
  titlebarIconSelector,
  titlebarTitleSelector,
  titlebarSearchBarTestId,
  titlebarCustomWcoTestId
} from './titlebarSelectors'

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
  toasterRootSelector,
  toasterHeaderSelector,
  toasterClearButtonSelector,
  toasterDndButtonSelector,
  toasterHideButtonSelector,
  toasterEmptyLabelSelector,
  toastSelector,
  toastByTitleSelector,
  toastCloseByTitleSelector
} from './toasterSelectors'

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
  searchBarRootSelector,
  searchBarClosedSelector,
  searchBarOpenSelector,
  searchBarInputBoxTestId,
  searchBarInputBoxSelector,
  searchBarInputSelector,
  searchBarScrollableTestId,
  searchBarResultsSelector,
  searchBarCategorySelector,
  searchBarResultSelector,
  searchBarTooltipSelector,
  searchBarTooltipMarkdownSelector
} from './searchBarSelectors'

export {
  toggleRootSelector,
  toggleActionSelector,
  toggleLabelSelector,
  toggleIconSelector
} from './toggleSelectors'

export { radioGroupRootSelector, radioGroupItemSelector } from './radioSelectors'

export { progressBarRootSelector, progressBarBitSelector } from './progressBarSelectors'

export {
  tabsRootSelector,
  tabsTabTestId,
  tabsTabSelector,
  tabsTabPanelTestId,
  tabsTabPanelSelector
} from './tabsSelectors'

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
  splitViewRootSelector,
  splitViewPaneTestId,
  splitViewPaneSelector,
  splitViewPaneHeaderSelector,
  splitViewPaneBodySelector,
  splitViewSashTestId,
  splitViewSashSelector
} from './splitViewSelectors'

export {
  markdownViewerRootSelector,
  markdownViewerCodeBlockSelector,
  markdownViewerCodeBlockCopySelector,
  markdownViewerMermaidSelector,
  markdownViewerLinkSelector
} from './markdownViewerSelectors'

export {
  markdownEditorRootSelector,
  markdownEditorMilkdownRootSelector,
  markdownEditorContentEditableSelector
} from './markdownEditorSelectors'

export {
  editorWorkbenchRootSelector,
  editorWorkbenchGroupSelector,
  editorWorkbenchGroupContentSelector,
  editorWorkbenchGroupTabsSelector,
  editorWorkbenchGroupTabsContainerSelector,
  editorWorkbenchTabSelector,
  editorWorkbenchTabLabelSelector,
  editorWorkbenchTabCloseSelector,
  editorWorkbenchGroupTabsContextMenuSelector,
  editorWorkbenchSashSelector
} from './workbenchSelectors'

export {
  menuBarRootSelector,
  menuBarMenuButtonSelector,
  menuBarMenuTitleSelector,
  menuBarMenuDropdownSelector,
  menuBarMenuScrollableSelector,
  menuBarItemSelector,
  menuBarItemLabelSelector,
  menuBarItemShortcutSelector,
  menuBarItemSubmenuSelector,
  menuBarItemSubmenuScrollableSelector
} from './menuBarSelectors'

export {
  statusbarRootSelector,
  statusbarElementSelector,
  statusbarElementLabelSelector,
  statusbarElementTooltipSelector
} from './statusbarSelectors'

export {
  tagsViewRootSelector,
  tagsViewListSelector,
  tagsViewTagSelector,
  tagsViewTagLabelSelector,
  tagsViewTagInputSelector,
  tagsViewAddSelector,
  tagsViewContextMenuSelector
} from './tagsViewSelectors'

export {
  dateTimePickerRootSelector,
  dateTimePickerInputSelector,
  dateTimePickerOpenSelector,
  dateTimePickerTargetSelector,
  dateTimePickerPopoverSelector,
  dateTimePickerMonthLabelSelector,
  dateTimePickerPrevMonthSelector,
  dateTimePickerNextMonthSelector,
  dateTimePickerDaySelector,
  dateTimePickerIncludeTimeSelector,
  dateTimePickerHoursSelector,
  dateTimePickerMinutesSelector,
  dateTimePickerOutputModeSelector,
  dateTimePickerPatternSelector,
  dateTimePickerPreviewValueSelector
} from './dateTimePickerSelectors'

export {
  iconSelectRootSelector,
  iconSelectButtonSelector,
  iconSelectPickerSelector,
  iconSelectTabSelector,
  iconSelectClearSelector,
  iconSelectPanelSelector,
  iconSelectSearchInputSelector,
  iconSelectSearchClearSelector,
  iconSelectIconSelector,
  iconSelectEmojiSelector
} from './iconSelectSelectors'

export {
  selectBoxRootSelector,
  selectBoxTriggerSelector,
  selectBoxDropdownSelector,
  selectBoxScrollableSelector,
  selectBoxListboxSelector,
  selectBoxOptionSelector,
  selectBoxOptionLabelSelector,
  selectBoxOptionDetailSelector,
  selectBoxOptionDecoratorSelector,
  selectBoxDetailsSelector
} from './selectBoxSelectors'

export {
  listViewRootSelector,
  listViewScrollableTestId,
  listViewScrollableContentSelector,
  listViewContextMenuTestId,
  listViewRowSelectorByItemId,
  listViewRowExpanderSelectorByItemId,
  listViewRowTitleSelectorByItemId,
  listViewRowSelectorByTitle,
  listViewRowExpanderSelectorByTitle,
  listViewRowTitleSelectorByTitle,
  listViewRenameInputSelector
} from './listViewSelectors'

export {
  settingsModalRootSelector,
  settingsPageRootSelector,
  settingsPageThemeCarouselTestId,
  settingsPageLanguageSelectBoxTestId,
  themeCarouselRootSelector,
  themeCarouselScrollableTestId
} from './settingsSelectors'

export {
  listViewDropdownRootSelector,
  listViewDropdownButtonTestId,
  listViewDropdownButtonAnchorSelector,
  listViewDropdownPanelSelector,
  listViewDropdownScrollableTestId,
  listViewDropdownScrollableSelector,
  listViewDropdownListViewTestId
} from './listViewDropdownSelectors'
