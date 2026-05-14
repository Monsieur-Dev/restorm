import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Titlebar,
  MenuBar,
  MenuBarItem,
  MenuItem,
  MenuItemSeparator,
  Button,
  useSettingsModal,
  useFeature,
  type SearchResult
} from 'electron-core-ui/renderer'
import { renderSearchTooltipContent } from './renderSearchTooltipContent'
import { Badge } from '../../common/Badge'
import { mapToBadgeType } from '../../../utils/badgeUtils'

export interface RestormTitlebarProps {
  fileName: string | null
  isDirty: boolean
  recentFiles: { path: string; name: string }[]
  favorites: { path: string; name: string }[]
  onNew: () => void
  onOpen: () => void
  onOpenFolder: () => void
  onSave: () => unknown
  onSaveAll: () => unknown
  onSaveAs: () => void
  onClose: () => void
  onExit: () => void
  onImport: () => void
  onOpenRecentFile: (path: string) => void
  onSearchResultClick: (result: SearchResult) => void
  /** Open / focus the firewall + outgoing-request console workbench
   * tab. Wired to the `View → Console` menu item; the host owns the
   * focus-or-create logic so the singleton-tab + bottom-group
   * placement decisions stay close to the workbench tree. */
  onOpenConsole: () => void
  /** Open / focus the Firewall admin singleton tab. Wired to the
   * `View → Firewall` menu item. Same singleton-or-focus pattern
   * as Console, but no specific placement constraint — the host
   * just appends to the focused group. */
  onOpenFirewall: () => void
  /** Open / focus the Mini browser singleton tab. Wired to
   * `View → Mini browser`. Same singleton-or-focus pattern as
   * Firewall. */
  onOpenMiniBrowser: () => void
}

/**
 * Main application titlebar with menu and search
 */
export const RestormTitlebar: React.FC<RestormTitlebarProps> = ({
  fileName,
  isDirty,
  recentFiles,
  favorites,
  onNew,
  onOpen,
  onOpenFolder,
  onSave,
  onSaveAll,
  onSaveAs,
  onClose,
  onExit,
  onImport,
  onOpenRecentFile,
  onSearchResultClick,
  onOpenConsole,
  onOpenFirewall,
  onOpenMiniBrowser
}) => {
  const { t } = useTranslation()
  const { showSettingsModal } = useSettingsModal()
  const { isEnabled: navigationEnabled } = useFeature('navigation')

  const handleMenuNew = useCallback(() => {
    onNew()
  }, [onNew])

  const handleMenuOpen = useCallback(() => {
    onOpen()
  }, [onOpen])

  const handleMenuOpenFolder = useCallback(() => {
    onOpenFolder()
  }, [onOpenFolder])

  const handleMenuSave = useCallback(() => {
    onSave()
  }, [onSave])

  const handleMenuSaveAll = useCallback(() => {
    onSaveAll()
  }, [onSaveAll])

  const handleMenuSaveAs = useCallback(() => {
    onSaveAs()
  }, [onSaveAs])

  const handleMenuClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleMenuExit = useCallback(() => {
    onExit()
  }, [onExit])

  const handleImport = useCallback(() => {
    onImport()
  }, [onImport])

  return (
    <Titlebar
      data-testid="main-titlebar"
      title={fileName ? `Restorm - ${fileName}${isDirty ? ' *' : ''}` : t('app.title')}
      showSearchBar
      showNavigation={navigationEnabled}
      onSearchResultClick={onSearchResultClick}
      renderSearchTooltipContent={renderSearchTooltipContent}
      renderSearchBadge={(method) => <Badge type={mapToBadgeType(method)} />}
      // The search popover hosts a draggable model graph; a fast pan
      // can push the cursor past the popover bounds for a frame
      // before pointer-lock pulls it back, which would dismiss it
      // with the default 300ms grace. 1s is comfortably above that
      // transient window without feeling sticky on normal exits.
      searchTooltipHideDelayMs={1000}
      leftContent={
        <MenuBar data-testid="titlebar-menubar">
          <MenuBarItem title={t('menuBar.file')} data-testid="titlebar-menubar-item-file">
            <MenuItem data-testid="titlebar-menu-item-new" title={t('menuBar.new')} shortcut="Ctrl+N" opensDialog onClick={handleMenuNew} />
            <MenuItemSeparator data-testid="titlebar-menu-separator-1" />
            <MenuItem data-testid="titlebar-menu-item-import" title={t('menuBar.import')} shortcut="Ctrl+I" opensDialog onClick={handleImport} />
            <MenuItemSeparator data-testid="titlebar-menu-separator-2" />
            <MenuItem data-testid="titlebar-menu-item-open" title={t('menuBar.open')} shortcut="Ctrl+O" opensDialog onClick={handleMenuOpen} />
            <MenuItem data-testid="titlebar-menu-item-open-folder" title={t('menuBar.openFolder')} opensDialog onClick={handleMenuOpenFolder} />
            {fileName && (
              <>
                <MenuItemSeparator data-testid="titlebar-menu-separator-3" />
                <MenuItem data-testid="titlebar-menu-item-save" title={t('menuBar.save')} shortcut="Ctrl+S" onClick={handleMenuSave} />
                <MenuItem data-testid="titlebar-menu-item-save-all" title={t('menuBar.saveAll')} shortcut="Ctrl+Shift+S" onClick={handleMenuSaveAll} />
                <MenuItem data-testid="titlebar-menu-item-save-as" title={t('menuBar.saveAs')} opensDialog onClick={handleMenuSaveAs} />
              </>
            )}
            {recentFiles.length > 0 && (
              <MenuItem data-testid="titlebar-menu-item-recent-files" title={t('menuBar.recentFiles')}>
                {recentFiles.slice(0, 10).map((file, index) => (
                  <MenuItem
                    key={file.path}
                    data-testid={`titlebar-menu-item-recent-file-${String(index)}`}
                    title={file.name}
                    onClick={() => { onOpenRecentFile(file.path) }}
                  />
                ))}
              </MenuItem>
            )}
            {favorites.length > 0 && (
              <MenuItem data-testid="titlebar-menu-item-favorites" title={t('menuBar.favorites')}>
                {favorites.map((file, index) => (
                  <MenuItem
                    key={file.path}
                    data-testid={`titlebar-menu-item-favorite-${String(index)}`}
                    title={file.name}
                    onClick={() => { onOpenRecentFile(file.path) }}
                  />
                ))}
              </MenuItem>
            )}
            {fileName && (
              <>
                <MenuItemSeparator data-testid="titlebar-menu-separator-4" />
                <MenuItem data-testid="titlebar-menu-item-close" title={t('menuBar.close')} onClick={handleMenuClose} />
              </>
            )}
            <MenuItemSeparator data-testid="titlebar-menu-separator-5" />
            <MenuItem data-testid="titlebar-menu-item-exit" title={t('menuBar.exit')} shortcut="Ctrl+Q" onClick={handleMenuExit} />
          </MenuBarItem>
          {/* Édition / Sélection / Affichage / Outils / Aide — items
              are intentionally disabled until each gets wired up. The
              skeleton lands here so the responsive overflow logic in
              ECUI's MenuBar has the full menu surface to test against. */}
          <MenuBarItem title={t('menuBar.edit')} data-testid="titlebar-menubar-item-edit">
            <MenuItem data-testid="titlebar-menu-item-undo" title={t('menuBar.undo')} shortcut="Ctrl+Z" disabled />
            <MenuItem data-testid="titlebar-menu-item-redo" title={t('menuBar.redo')} shortcut="Ctrl+Shift+Z" disabled />
            <MenuItemSeparator data-testid="titlebar-menu-separator-edit-1" />
            <MenuItem data-testid="titlebar-menu-item-cut" title={t('menuBar.cut')} shortcut="Ctrl+X" disabled />
            <MenuItem data-testid="titlebar-menu-item-copy" title={t('menuBar.copy')} shortcut="Ctrl+C" disabled />
            <MenuItem data-testid="titlebar-menu-item-paste" title={t('menuBar.paste')} shortcut="Ctrl+V" disabled />
            <MenuItemSeparator data-testid="titlebar-menu-separator-edit-2" />
            <MenuItem data-testid="titlebar-menu-item-find" title={t('menuBar.find')} shortcut="Ctrl+F" disabled />
            <MenuItem data-testid="titlebar-menu-item-replace" title={t('menuBar.replace')} shortcut="Ctrl+H" disabled />
            <MenuItem data-testid="titlebar-menu-item-find-in-collection" title={t('menuBar.findInCollection')} shortcut="Ctrl+Shift+F" disabled />
          </MenuBarItem>
          <MenuBarItem title={t('menuBar.selection')} data-testid="titlebar-menubar-item-selection">
            <MenuItem data-testid="titlebar-menu-item-add-request" title={t('menuBar.addRequest')}>
              <MenuItem data-testid="titlebar-menu-item-add-request-http" title={t('menuBar.addRequestHttp')} disabled />
              <MenuItem data-testid="titlebar-menu-item-add-request-graphql" title={t('menuBar.addRequestGraphql')} disabled />
              <MenuItem data-testid="titlebar-menu-item-add-request-grpc" title={t('menuBar.addRequestGrpc')} disabled />
              <MenuItem data-testid="titlebar-menu-item-add-request-soap" title={t('menuBar.addRequestSoap')} disabled />
              <MenuItem data-testid="titlebar-menu-item-add-request-odata" title={t('menuBar.addRequestOdata')} disabled />
              <MenuItem data-testid="titlebar-menu-item-add-request-websocket" title={t('menuBar.addRequestWebsocket')} disabled />
            </MenuItem>
            <MenuItem data-testid="titlebar-menu-item-add-folder" title={t('menuBar.addFolder')} disabled />
            <MenuItem data-testid="titlebar-menu-item-add-env-folder" title={t('menuBar.addEnvironmentFolder')} disabled />
            <MenuItem data-testid="titlebar-menu-item-add-variable" title={t('menuBar.addVariable')} disabled />
            <MenuItem data-testid="titlebar-menu-item-add-tag" title={t('menuBar.addTag')} disabled />
            <MenuItemSeparator data-testid="titlebar-menu-separator-selection-1" />
            <MenuItem data-testid="titlebar-menu-item-expand-all" title={t('menuBar.expandAllFolders')} disabled />
            <MenuItem data-testid="titlebar-menu-item-collapse-all" title={t('menuBar.collapseAllFolders')} disabled />
            <MenuItemSeparator data-testid="titlebar-menu-separator-selection-2" />
            <MenuItem data-testid="titlebar-menu-item-send-request" title={t('menuBar.sendActiveRequest')} disabled />
            <MenuItem data-testid="titlebar-menu-item-cancel-request" title={t('menuBar.cancelActiveRequest')} disabled />
          </MenuBarItem>
          <MenuBarItem title={t('menuBar.view')} data-testid="titlebar-menubar-item-view">
            <MenuItem data-testid="titlebar-menu-item-toggle-sidebar" title={t('menuBar.toggleSidebar')} disabled />
            <MenuItem data-testid="titlebar-menu-item-toggle-response-panel" title={t('menuBar.toggleResponsePanel')} disabled />
            <MenuItem
              data-testid="titlebar-menu-item-console"
              title={t('menuBar.console', 'Console')}
              onClick={onOpenConsole}
            />
            <MenuItem
              data-testid="titlebar-menu-item-firewall"
              title={t('menuBar.firewall', 'Firewall')}
              onClick={onOpenFirewall}
            />
            <MenuItem
              data-testid="titlebar-menu-item-mini-browser"
              title={t('menuBar.miniBrowser', 'Mini browser')}
              onClick={onOpenMiniBrowser}
            />
            <MenuItemSeparator data-testid="titlebar-menu-separator-view-1" />
            <MenuItem data-testid="titlebar-menu-item-zoom-in" title={t('menuBar.zoomIn')} shortcut="Ctrl++" disabled />
            <MenuItem data-testid="titlebar-menu-item-zoom-out" title={t('menuBar.zoomOut')} shortcut="Ctrl+-" disabled />
            <MenuItem data-testid="titlebar-menu-item-reset-zoom" title={t('menuBar.resetZoom')} shortcut="Ctrl+0" disabled />
            <MenuItemSeparator data-testid="titlebar-menu-separator-view-2" />
            <MenuItem
              data-testid="titlebar-menu-item-settings"
              title={t('menuBar.settings')}
              onClick={() => { showSettingsModal() }}
            />
            <MenuItemSeparator data-testid="titlebar-menu-separator-view-3" />
            <MenuItem data-testid="titlebar-menu-item-toggle-devtools" title={t('menuBar.toggleDevTools')} disabled />
            <MenuItem data-testid="titlebar-menu-item-toggle-fullscreen" title={t('menuBar.toggleFullscreen')} disabled />
          </MenuBarItem>
          <MenuBarItem title={t('menuBar.tools')} data-testid="titlebar-menubar-item-tools">
            <MenuItem data-testid="titlebar-menu-item-generate-snippet" title={t('menuBar.generateCodeSnippet')} disabled />
            <MenuItem data-testid="titlebar-menu-item-copy-as-curl" title={t('menuBar.copyAsCurl')} disabled />
            <MenuItem data-testid="titlebar-menu-item-export-openapi" title={t('menuBar.exportOpenApi')} disabled />
            <MenuItem data-testid="titlebar-menu-item-clear-auth-cache" title={t('menuBar.clearAuthCache')} disabled />
            <MenuItemSeparator data-testid="titlebar-menu-separator-tools-1" />
            <MenuItem data-testid="titlebar-menu-item-open-logs" title={t('menuBar.openLogsFolder')} disabled />
          </MenuBarItem>
          <MenuBarItem title={t('menuBar.help')} data-testid="titlebar-menubar-item-help">
            <MenuItem data-testid="titlebar-menu-item-about" title={t('menuBar.about')} disabled />
            <MenuItem data-testid="titlebar-menu-item-documentation" title={t('menuBar.documentation')} disabled />
            <MenuItem data-testid="titlebar-menu-item-keyboard-shortcuts" title={t('menuBar.keyboardShortcuts')} disabled />
            <MenuItem data-testid="titlebar-menu-item-release-notes" title={t('menuBar.releaseNotes')} disabled />
            <MenuItem data-testid="titlebar-menu-item-report-issue" title={t('menuBar.reportIssue')} disabled />
          </MenuBarItem>
        </MenuBar>
      }
      rightContent={
        <Button
          data-testid="titlebar-settings-button"
          small
          secondary
          icon="gear"
          onClick={() => {
            showSettingsModal()
          }}
          options={{
            ariaLabel: t('app.openSettings'),
            title: t('app.openSettings')
          }}
        />
      }
    />
  )
}

export default RestormTitlebar
