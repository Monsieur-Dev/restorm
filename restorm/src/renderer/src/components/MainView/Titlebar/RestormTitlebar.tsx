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
  onSave: () => void
  onSaveAs: () => void
  onClose: () => void
  onExit: () => void
  onImport: () => void
  onOpenRecentFile: (path: string) => void
  onSearchResultClick: (result: SearchResult) => void
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
  onSaveAs,
  onClose,
  onExit,
  onImport,
  onOpenRecentFile,
  onSearchResultClick
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
      leftContent={
        <MenuBar data-testid="titlebar-menubar">
          <MenuBarItem title={t('menuBar.file')} data-testid="titlebar-menubar-item-file">
            <MenuItem data-testid="titlebar-menu-item-new" title={t('menuBar.new')} shortcut="Ctrl+N" onClick={handleMenuNew} />
            <MenuItemSeparator data-testid="titlebar-menu-separator-1" />
            <MenuItem data-testid="titlebar-menu-item-import" title={t('menuBar.import')} shortcut="Ctrl+I" onClick={handleImport} />
            <MenuItemSeparator data-testid="titlebar-menu-separator-2" />
            <MenuItem data-testid="titlebar-menu-item-open" title={t('menuBar.open')} shortcut="Ctrl+O" onClick={handleMenuOpen} />
            <MenuItem data-testid="titlebar-menu-item-open-folder" title={t('menuBar.openFolder')} onClick={handleMenuOpenFolder} />
            {fileName && (
              <>
                <MenuItemSeparator data-testid="titlebar-menu-separator-3" />
                <MenuItem data-testid="titlebar-menu-item-save" title={t('menuBar.save')} shortcut="Ctrl+S" onClick={handleMenuSave} />
                <MenuItem data-testid="titlebar-menu-item-save-as" title={t('menuBar.saveAs')} shortcut="Ctrl+Shift+S" onClick={handleMenuSaveAs} />
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
