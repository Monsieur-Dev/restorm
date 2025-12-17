# CSS Variables Report - electron-core-ui

This document lists all CSS variables used in the project and their values across different themes.

## Theme Legend

| ID | Theme Name | Type |
|----|------------|------|
| 1 | Abyss | dark |
| 2 | Monokai | dark |
| 3 | Kimbie Dark | dark |
| 4 | Monokai Dimmed | dark |
| 5 | Quiet Light | light |
| 6 | Red | dark |
| 7 | Solarized Dark | dark |
| 8 | Solarized Light | light |
| 9 | Tomorrow Night Blue | dark |
| 10 | Dark+ | dark |
| 11 | Default Dark Modern | dark |
| 12 | Light+ | light |
| 13 | Default Light Modern | light |
| 14 | Visual Studio Dark | dark |
| 15 | Visual Studio Light | light |
| 16 | Dark High Contrast | hc |
| 17 | Light High Contrast | hcLight |

---

## Custom Component Variables

These are custom CSS variables defined within the project components.

| Name | Description | Default Value |
|------|-------------|---------------|
| `--dropdown-padding-top` | Padding top for dropdown items | `1px` (mac: `3px`) |
| `--dropdown-padding-bottom` | Padding bottom for dropdown items | `1px` (mac: `4px`) |
| `--sash-size` | Size of sash divider | `4px` |
| `--sash-hover-size` | Hover size of sash divider | `8px` |
| `--editor-group-tab-height` | Height of editor tabs | `35px` |
| `--monaco-monospace-font` | Monospace font family | Platform-dependent |
| `--text-link-decoration` | Text link decoration style | `underline` |
| `--beak-left-percent` | Tooltip beak position | `50%` |
| `--tabs-border-bottom-color` | Border color for tabs | `transparent` |
| `--ag-font-size` | AG Grid font size | `12px` |

---

## Editor Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `editor.background` | Editor background color | `#000c18` | `#272822` | `#221a0f` | `#1e1e1e` | `#F5F5F5` | `#390000` | `#002B36` | `#FDF6E3` | `#002451` | - | `#1F1F1F` | - | `#FFFFFF` | `#1E1E1E` | `#FFFFFF` | `#000000` | - |
| `editor.foreground` | Editor foreground color | `#6688cc` | `#f8f8f2` | `#d3af86` | `#c5c8c6` | - | `#F8F8F8` | `#839496` | `#657B83` | `#ffffff` | - | `#CCCCCC` | - | `#3B3B3B` | `#D4D4D4` | `#000000` | `#FFFFFF` | - |
| `editorCursor.foreground` | Cursor color | `#ddbb88` | `#f8f8f0` | `#d3af86` | `#c07020` | `#54494B` | `#970000` | `#D30102` | `#657B83` | `#ffffff` | - | - | - | - | - | - | - | - |
| `editorLineNumber.foreground` | Line number color | `#406385` | `#90908a` | - | - | `#6D705B` | `#ff777788` | - | - | - | - | `#6E7681` | - | `#6E7681` | - | - | - | - |
| `editorLineNumber.activeForeground` | Active line number | `#80a2c2` | `#c2c2bf` | `#adadad` | `#949494` | `#9769dc` | `#ffbbbb88` | `#949494` | `#567983` | `#949494` | - | `#CCCCCC` | - | `#171184` | - | - | - | - |
| `editorWhitespace.foreground` | Whitespace color | `#103050` | `#464741` | `#a57a4c` | `#505037` | `#AAAAAA` | `#c10000` | `#93A1A180` | `#586E7580` | `#404f7d` | - | - | - | - | - | - | `#7c7c7c` | - |
| `editor.lineHighlightBackground` | Line highlight | `#082050` | `#3e3d32` | `#5e452b` | `#303030` | `#E4F6D4` | `#ff000033` | `#073642` | `#EEE8D5` | `#00346e` | - | - | - | - | - | - | - | - |
| `editor.selectionBackground` | Selection background | `#770811` | `#878b9180` | `#84613daa` | `#676b7180` | `#C9D0D9` | `#750000` | `#274642` | `#EEE8D5` | `#003f8e` | - | - | - | - | - | - | `#FFFFFF` | - |

---

## Focus & Input Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `focusBorder` | Focus border color | `#596F99` | `#99947c` | `#a57a4c` | `#3655b5` | `#9769dc` | `#ff6666aa` | `#2AA19899` | `#b49471` | `#bbdaff` | - | `#0078D4` | - | `#005FB8` | - | - | - | - |
| `input.background` | Input background | `#181f2f` | `#414339` | `#51412c` | - | - | `#580000` | `#003847` | `#DDD6C1` | `#001733` | - | `#313131` | - | `#FFFFFF` | - | - | - | - |
| `input.foreground` | Input foreground | - | - | - | - | - | - | `#93A1A1` | `#586E75` | - | - | `#CCCCCC` | - | `#3B3B3B` | - | - | - | - |
| `input.border` | Input border | - | - | - | - | - | - | - | - | - | - | `#3C3C3C` | - | `#CECECE` | - | - | - | - |
| `input.placeholderForeground` | Placeholder color | - | - | - | - | - | - | `#93A1A1AA` | `#586E75AA` | - | - | `#989898` | - | `#767676` | `#A6A6A6` | `#767676` | - | - |
| `inputOption.activeBorder` | Active option border | `#1D4A87` | `#75715E` | `#a57a4c` | `#3655b5` | `#adafb7` | `#cc0000` | `#2AA19899` | `#D3AF86` | - | - | `#2488DB` | - | `#005FB8` | - | - | - | - |

---

## Input Validation Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `inputValidation.infoBorder` | Info validation border | `#384078` | `#819aff` | `#1b60a5` | - | `#4ec1e5` | `#DB7E58` | `#363b5f` | - | - | - | - | - | - | - | - | - | - |
| `inputValidation.infoBackground` | Info validation bg | `#051336` | `#546190` | `#2b2a42` | - | `#f2fcff` | `#550000` | `#052730` | - | - | - | - | - | - | - | - | - | - |
| `inputValidation.warningBorder` | Warning validation border | `#5B7E7A` | `#e2e22e` | - | - | `#ffe055` | - | `#9d8a5e` | - | - | - | - | - | - | - | - | - | - |
| `inputValidation.warningBackground` | Warning validation bg | `#5B7E7A` | `#848528` | `#51412c` | - | `#fffee2` | - | `#5d5938` | - | - | - | - | - | - | - | - | - | - |
| `inputValidation.errorBorder` | Error validation border | `#AB395B` | `#f92672` | `#9d2f23` | - | `#f1897f` | - | `#a92049` | - | - | - | - | - | - | - | - | - | - |
| `inputValidation.errorBackground` | Error validation bg | `#A22D44` | `#90274A` | `#5f0d0d` | - | `#ffeaea` | - | `#571b26` | - | - | - | - | - | - | - | - | - | - |

---

## List Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `list.activeSelectionBackground` | Active selection bg | `#08286b` | `#75715E` | `#7c5021` | `#707070` | `#c4d9b1` | `#880000` | `#005A6F` | `#DFCA88` | `#ffffff60` | - | - | - | `#E8E8E8` | - | - | - | - |
| `list.activeSelectionForeground` | Active selection fg | - | - | - | - | `#6c6c6c` | - | - | `#6C6C6C` | - | - | - | - | `#000000` | - | - | - | - |
| `list.hoverBackground` | Hover background | `#061940` | `#3e3d32` | `#7c502166` | `#444444` | `#e0e0e0` | `#800000` | `#004454AA` | `#DFCA8844` | `#ffffff30` | - | - | - | `#F2F2F2` | - | `#E8E8E8` | - | - |
| `list.hoverForeground` | Hover foreground | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| `list.inactiveSelectionBackground` | Inactive selection bg | `#152037` | `#414339` | `#645342` | `#4e4e4e` | `#d3dbcd` | `#770000` | `#00445488` | `#D1CBB8` | `#ffffff40` | - | - | - | - | - | - | - | - |
| `list.highlightForeground` | Highlight foreground | `#0063a5` | `#f8f8f2` | `#e3b583` | `#e58520` | `#9769dc` | `#ff4444` | `#1ebcc5` | `#B58900` | `#bbdaff` | - | - | - | - | - | - | - | - |
| `list.dropBackground` | Drop target background | `#041D52` | `#414339` | - | - | - | `#662222` | `#00445488` | - | - | `#383B3D` | - | - | - | - | - | - | - |

---

## Dropdown Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `dropdown.background` | Dropdown background | `#181f2f` | `#414339` | `#51412c` | `#525252` | `#F5F5F5` | `#580000` | `#00212B` | `#EEE8D5` | `#001733` | - | `#313131` | - | `#FFFFFF` | - | - | - | - |
| `dropdown.foreground` | Dropdown foreground | - | - | - | - | - | - | - | - | - | - | `#CCCCCC` | - | `#3B3B3B` | - | - | - | - |
| `dropdown.border` | Dropdown border | - | - | - | - | - | - | `#2AA19899` | `#D3AF86` | - | - | `#3C3C3C` | - | `#CECECE` | - | - | - | - |
| `dropdown.listBackground` | Dropdown list bg | - | `#1e1f1c` | - | - | - | - | - | - | - | - | `#1F1F1F` | - | `#FFFFFF` | - | - | - | - |

---

## Button Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `button.background` | Button background | `#2B3C5D` | `#75715E` | `#6e583b` | `#565656` | `#705697` | `#833` | `#2AA19899` | `#AC9D57` | - | - | `#0078D4` | - | `#005FB8` | - | - | - | - |
| `button.foreground` | Button foreground | - | - | - | - | - | - | - | - | - | - | `#FFFFFF` | - | `#FFFFFF` | - | - | - | - |
| `button.hoverBackground` | Button hover bg | - | - | - | - | - | - | - | - | - | `#3C3C3C` | `#026EC1` | - | `#0258A8` | - | - | - | - |
| `button.border` | Button border | - | - | - | - | - | - | - | - | - | - | `#FFFFFF12` | - | `#0000001a` | - | - | - | - |

---

## Scrollbar Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `scrollbar.shadow` | Scrollbar shadow | `#515E91AA` | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| `scrollbarSlider.background` | Slider background | `#1F2230AA` | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| `scrollbarSlider.hoverBackground` | Slider hover bg | `#3B3F5188` | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| `scrollbarSlider.activeBackground` | Slider active bg | `#3B3F5188` | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |

---

## Tab Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `tab.activeBackground` | Active tab bg | - | - | - | - | - | `#490000` | `#002B37` | `#FDF6E3` | - | - | `#1F1F1F` | - | `#FFFFFF` | - | - | - | - |
| `tab.activeForeground` | Active tab fg | - | - | - | - | - | - | `#d6dbdb` | - | - | - | `#FFFFFF` | - | `#3B3B3B` | - | - | - | - |
| `tab.inactiveBackground` | Inactive tab bg | `#10192c` | `#34352f` | `#131510` | `#404040` | - | `#300a0a` | `#004052` | `#D3CBB7` | `#001c40` | - | `#181818` | - | `#F8F8F8` | - | - | - | - |
| `tab.inactiveForeground` | Inactive tab fg | - | `#ccccc7` | - | `#d8d8d8` | - | - | `#93A1A1` | `#586E75` | - | - | `#9D9D9D` | - | `#868686` | - | - | - | - |
| `tab.border` | Tab border | `#2b2b4a` | `#1e1f1c` | - | `#303030` | - | - | `#003847` | `#DDD6C1` | - | - | `#2B2B2B` | - | `#E5E5E5` | - | - | - | - |
| `tab.lastPinnedBorder` | Last pinned border | `#2b3c5d` | `#414339` | `#51412c` | `#505050` | `#c9d0d9` | `#ff000044` | `#2AA19844` | `#FDF6E3` | `#007acc80` | - | - | - | `#D4D4D4` | `#ccc3` | `#61616130` | - | - |
| `tab.activeBorderTop` | Active tab top border | - | - | - | - | - | - | - | - | - | - | `#0078D4` | - | `#005FB8` | - | - | - | - |

---

## Status Bar Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `statusBar.background` | Status bar bg | `#10192c` | `#414339` | `#423523` | `#505050` | `#705697` | `#700000` | `#00212B` | `#EEE8D5` | `#001126` | - | `#181818` | - | `#F8F8F8` | - | - | - | - |
| `statusBar.foreground` | Status bar fg | - | - | - | - | - | - | `#93A1A1` | `#586E75` | - | - | `#CCCCCC` | - | `#3B3B3B` | - | - | - | - |
| `statusBar.border` | Status bar border | - | - | - | - | - | - | - | - | - | - | `#2B2B2B` | - | `#E5E5E5` | - | - | - | - |
| `statusBar.debuggingBackground` | Debugging bg | `#10192c` | `#75715E` | `#423523` | `#505050` | `#705697` | - | `#00212B` | `#EEE8D5` | `#001126` | - | `#0078D4` | - | `#FD716C` | - | - | - | - |
| `statusBar.noFolderBackground` | No folder bg | `#10192c` | `#414339` | `#423523` | `#505050` | `#705697` | `#700000` | `#00212B` | `#EEE8D5` | `#001126` | - | `#1F1F1F` | - | `#F8F8F8` | - | - | - | - |
| `statusBarItem.remoteBackground` | Remote item bg | `#0063a5` | `#AC6218` | `#6e583b` | `#3655b5` | `#4e3c69` | `#c33` | `#2AA19899` | `#AC9D57` | `#0e639c` | - | `#0078D4` | - | `#005FB8` | `#16825D` | `#16825D` | `#00000000` | `#FFFFFF` |

---

## Title Bar Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `titleBar.activeBackground` | Active title bar bg | `#10192c` | `#1e1f1c` | `#423523` | `#505050` | `#c4b7d7` | `#770000` | `#002C39` | `#EEE8D5` | `#001126` | - | `#181818` | - | `#F8F8F8` | - | - | - | - |
| `titleBar.activeForeground` | Active title bar fg | - | - | - | - | - | - | - | - | - | - | `#CCCCCC` | - | `#1E1E1E` | - | - | - | - |
| `titleBar.inactiveBackground` | Inactive title bar bg | - | - | - | - | - | `#772222` | - | - | - | - | `#1F1F1F` | - | `#F8F8F8` | - | - | - | - |
| `titleBar.border` | Title bar border | - | - | - | - | - | - | - | - | - | - | `#2B2B2B` | - | `#E5E5E5` | - | - | - | - |

---

## Activity Bar Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `activityBar.background` | Activity bar bg | `#051336` | `#272822` | `#221a0f` | `#353535` | `#EDEDF5` | `#580000` | `#003847` | `#DDD6C1` | `#001733` | - | `#181818` | - | `#F8F8F8` | - | - | - | - |
| `activityBar.foreground` | Activity bar fg | - | `#f8f8f2` | `#d3af86` | `#ffffff` | `#705697` | - | - | `#584c27` | - | - | `#D7D7D7` | - | `#1F1F1F` | - | - | - | - |
| `activityBarBadge.background` | Badge bg | - | - | `#3655b5` | - | `#705697` | - | - | `#B58900` | - | `#007ACC` | `#0078D4` | - | `#005FB8` | `#007ACC` | `#007ACC` | - | - |

---

## Side Bar Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `sideBar.background` | Side bar bg | `#060621` | `#1e1f1c` | `#362712` | `#272727` | `#F2F2F2` | `#330000` | `#00212B` | `#EEE8D5` | `#001c40` | - | `#181818` | - | `#F8F8F8` | - | - | - | - |
| `sideBarTitle.foreground` | Side bar title fg | - | - | - | - | - | - | `#93A1A1` | `#586E75` | - | `#BBBBBB` | `#CCCCCC` | - | `#3B3B3B` | - | `#6F6F6F` | `#FFFFFF` | - |
| `sideBarSectionHeader.background` | Section header bg | `#10192c` | `#272822` | - | `#505050` | `#ede8ef` | - | - | - | - | `#0000` | `#181818` | - | `#F8F8F8` | `#0000` | `#0000` | - | - |

---

## Panel Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `panel.border` | Panel border | `#2b2b4a` | `#414339` | - | - | - | - | `#2b2b4a` | `#DDD6C1` | - | - | `#2B2B2B` | - | `#E5E5E5` | - | - | - | - |
| `panel.background` | Panel background | - | - | - | - | `#F5F5F5` | - | - | - | - | - | `#181818` | - | `#F8F8F8` | - | - | - | - |
| `panelTitle.activeForeground` | Active title fg | - | `#f8f8f2` | - | `#ffffff` | - | - | - | - | - | - | `#CCCCCC` | - | `#3B3B3B` | - | - | - | - |
| `panelTitle.inactiveForeground` | Inactive title fg | - | `#75715E` | - | - | - | - | - | - | - | - | `#9D9D9D` | - | `#3B3B3B` | - | - | - | - |
| `panelTitle.activeBorder` | Active border | - | `#75715E` | - | - | - | - | - | - | - | - | `#0078D4` | - | `#005FB8` | - | - | - | - |

---

## Editor Group Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `editorGroup.border` | Group border | `#2b2b4a` | `#34352f` | - | - | - | `#ff666633` | `#00212B` | `#DDD6C1` | `#404f7d` | - | `#FFFFFF17` | - | `#E5E5E5` | - | - | - | - |
| `editorGroup.dropBackground` | Drop background | `#25375daa` | `#41433980` | - | - | `#C9D0D988` | - | `#2AA19844` | `#DDD6C1AA` | `#25375daa` | - | - | - | - | - | - | - | - |
| `editorGroupHeader.tabsBackground` | Tabs header bg | `#1c1c2a` | `#1e1f1c` | `#131510` | `#282828` | - | `#330000` | `#004052` | `#D9D2C2` | `#001733` | - | `#181818` | - | `#F8F8F8` | - | - | - | - |

---

## Widget Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `editorWidget.background` | Widget background | `#262641` | `#1e1f1c` | `#131510` | - | - | `#300000` | `#00212B` | `#EEE8D5` | `#001c40` | - | `#202020` | - | `#F8F8F8` | - | - | - | - |
| `editorHoverWidget.background` | Hover widget bg | `#000c38` | `#414339` | `#221a14` | - | - | `#300000` | `#004052` | `#CCC4B0` | `#001c40` | - | - | - | - | - | - | - | - |
| `editorHoverWidget.border` | Hover widget border | `#004c18` | `#75715E` | - | - | - | - | - | - | `#ffffff44` | - | - | - | - | - | - | - | - |
| `widget.shadow` | Widget shadow | - | `#00000098` | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |

---

## Peek View Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `peekView.border` | Peek view border | `#2b2b4a` | `#75715E` | `#5e452b` | `#3655b5` | `#705697` | `#ff000044` | `#2b2b4a` | `#B58900` | - | - | - | - | - | - | - | - | - |
| `peekViewTitle.background` | Title background | `#10192c` | `#1e1f1c` | `#362712` | - | `#F2F8FC` | `#550000` | `#00212B` | `#EEE8D5` | - | - | - | - | - | - | - | - | - |
| `peekViewEditor.background` | Editor background | `#10192c` | `#272822` | `#221a14` | - | `#F2F8FC` | `#300000` | `#10192c` | `#FFFBF2` | - | - | `#1F1F1F` | - | - | - | - | - | - |
| `peekViewResult.background` | Result background | `#060621` | `#1e1f1c` | `#362712` | - | `#F2F8FC` | `#400000` | `#00212B` | `#EEE8D5` | `#001c40` | - | `#1F1F1F` | - | `#FFFFFF` | - | - | - | - |

---

## Badge & Progress Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `badge.background` | Badge background | `#0063a5` | `#75715E` | `#7f5d38` | - | `#705697AA` | `#cc3333` | `#047aa6` | `#B58900AA` | `#bbdaffcc` | - | `#616161` | - | `#CCCCCC` | - | - | - | - |
| `badge.foreground` | Badge foreground | - | `#f8f8f2` | - | - | - | - | - | - | `#001733` | - | `#F8F8F8` | - | `#3B3B3B` | - | - | - | - |
| `progressBar.background` | Progress bar bg | `#0063a5` | `#75715E` | `#7f5d38` | - | `#705697` | `#cc3333` | `#047aa6` | `#B58900` | `#bbdaffcc` | - | `#0078D4` | - | `#005FB8` | - | - | - | - |

---

## Picker Group Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `pickerGroup.foreground` | Picker group fg | `#596F99` | `#75715E` | `#e3b583` | `#b0b0b0` | `#A6B39B` | `#cc9999` | `#2AA19899` | `#2AA19899` | `#bbdaff` | - | - | - | `#8B949E` | - | - | - | - |
| `pickerGroup.border` | Picker group border | `#596F99` | - | `#e3b583` | - | `#749351` | `#ff000033` | `#2AA19899` | `#2AA19899` | - | - | `#3C3C3C` | - | `#E5E5E5` | - | - | - | - |

---

## Quick Input Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `quickInputList.focusBackground` | Focus background | `#08286b` | `#414339` | `#7c5021AA` | `#707070` | `#CADEB9` | `#660000` | `#005A6F` | `#DFCA8866` | `#ffffff60` | - | - | - | - | - | - | - | - |

---

## Debug Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `debugToolBar.background` | Debug toolbar bg | `#051336` | `#1e1f1c` | - | - | - | `#660000` | `#00212B` | `#DDD6C1` | `#001c40` | - | `#181818` | - | - | - | - | - | - |
| `debugExceptionWidget.background` | Exception widget bg | `#051336` | - | - | - | - | - | `#00212B` | `#DDD6C1` | - | - | - | - | - | - | - | - | - |
| `debugExceptionWidget.border` | Exception widget border | `#AB395B` | - | - | - | - | - | `#AB395B` | `#AB395B` | - | - | - | - | - | - | - | - | - |

---

## Diff Editor Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `diffEditor.insertedTextBackground` | Inserted text bg | `#31958A55` | `#4b661680` | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| `diffEditor.removedTextBackground` | Removed text bg | `#892F4688` | `#90274A70` | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |

---

## Terminal Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `terminal.ansiBlack` | ANSI Black | `#111111` | `#333333` | - | `#1e1e1e` | - | - | `#073642` | `#073642` | `#111111` | - | - | - | - | - | - | - | - |
| `terminal.ansiRed` | ANSI Red | `#ff9da4` | `#C4265E` | - | `#C4265E` | - | - | `#dc322f` | `#dc322f` | `#ff9da4` | - | - | - | - | - | - | - | - |
| `terminal.ansiGreen` | ANSI Green | `#d1f1a9` | `#86B42B` | - | `#86B42B` | - | - | `#859900` | `#859900` | `#d1f1a9` | - | - | - | - | - | - | - | - |
| `terminal.ansiYellow` | ANSI Yellow | `#ffeead` | `#B3B42B` | - | `#B3B42B` | - | - | `#b58900` | `#b58900` | `#ffeead` | - | - | - | - | - | - | - | - |
| `terminal.ansiBlue` | ANSI Blue | `#bbdaff` | `#6A7EC8` | - | `#6A7EC8` | - | - | `#268bd2` | `#268bd2` | `#bbdaff` | - | - | - | - | - | - | - | - |
| `terminal.ansiMagenta` | ANSI Magenta | `#ebbbff` | `#8C6BC8` | - | `#8C6BC8` | - | - | `#d33682` | `#d33682` | `#ebbbff` | - | - | - | - | - | - | - | - |
| `terminal.ansiCyan` | ANSI Cyan | `#99ffff` | `#56ADBC` | - | `#56ADBC` | - | - | `#2aa198` | `#2aa198` | `#99ffff` | - | - | - | - | - | - | - | - |
| `terminal.ansiWhite` | ANSI White | `#cccccc` | `#e3e3dd` | - | `#e3e3dd` | - | - | `#eee8d5` | `#eee8d5` | `#cccccc` | - | - | - | - | - | - | - | - |
| `terminal.foreground` | Terminal fg | - | - | - | - | - | - | - | - | - | - | `#CCCCCC` | - | `#3B3B3B` | - | - | - | - |

---

## Menu Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `menu.background` | Menu background | - | `#1e1f1c` | `#362712` | `#272727` | - | - | - | - | - | `#252526` | `#1F1F1F` | - | - | `#252526` | - | - | - |
| `menu.foreground` | Menu foreground | - | `#cccccc` | `#CCCCCC` | `#CCCCCC` | - | - | - | - | - | `#CCCCCC` | - | - | - | `#CCCCCC` | - | - | - |
| `menu.selectionBackground` | Selection bg | - | - | - | - | - | - | - | - | - | `#0078d4` | `#0078d4` | - | `#005FB8` | `#0078d4` | - | - | - |
| `menu.border` | Menu border | - | - | - | - | - | - | - | - | - | `#454545` | - | - | `#CECECE` | `#454545` | `#D4D4D4` | - | - |

---

## Error & Warning Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `errorForeground` | Error foreground | - | - | - | - | `#f1897f` | `#ffeaea` | `#ffeaea` | - | `#a92049` | - | `#F85149` | - | `#F85149` | - | - | - | - |

---

## Selection Variables

| Name | Description | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 |
|------|-------------|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| `selection.background` | Selection bg | - | `#878b9180` | `#84613daa` | - | `#C9D0D9` | `#ff777788` | `#2AA19899` | `#878b9180` | - | - | - | - | - | - | - | `#008000` | - |
| `minimap.selectionHighlight` | Minimap selection | `#750000` | `#878b9180` | `#84613daa` | `#676b7180` | `#C9D0D9` | `#750000` | `#274642` | `#EEE8D5` | `#003f8e` | - | - | - | - | - | - | - | - |

---

## Notes

- `-` indicates the variable is not defined in that theme (inherits from base or uses default)
- Theme numbers correspond to the Theme Legend table above
- CSS variables are used as `var(--{property})` in the code
- Some themes extend others (e.g., Dark+ extends dark_vs, Dark Modern extends Dark+)
- High Contrast themes (16, 17) have special accessibility considerations

---

## Files Using CSS Variables

The following files in the project use CSS variables:

### CSS Files
- `src/renderer/components/SelectBox/selectBoxCustom.css`
- `src/renderer/components/Sash/sash.css`
- `src/renderer/components/InputTable/inputTable.css`
- `src/renderer/assets/monaco-workbench.css`
- `src/renderer/components/Workbench/styles/tabs.css`
- `src/renderer/components/Tooltip/tooltip.css`
- `src/renderer/components/Toggle/toggle.css`
- `src/renderer/components/Titlebar/titlebar.css`
- `src/renderer/components/Statusbar/statusbar.css`
- `src/renderer/components/SplitView/splitview.css`
- `src/renderer/components/SelectBox/selectBox.css`
- `src/renderer/components/ScrollableElement/scrollbars.css`
- `src/renderer/components/Radio/radio.css`

### TypeScript/TSX Files
- `src/renderer/components/Workbench/EditorTabs.tsx`
- `src/renderer/components/Toggle/types.ts`
- `src/renderer/components/Toggle/Toggle.tsx`
- `src/renderer/components/Tabs/Tabs.tsx`
- `src/renderer/components/SelectBox/types.ts`
- `src/renderer/components/ScrollableElement/types.ts`
- `src/renderer/components/ScrollableElement/ScrollableElement.tsx`
