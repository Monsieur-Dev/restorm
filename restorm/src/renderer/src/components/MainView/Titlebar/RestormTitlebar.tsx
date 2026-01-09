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
      title={fileName ? `Restorm - ${fileName}${isDirty ? ' *' : ''}` : t('app.title')}
      showSearchBar
      onSearchResultClick={onSearchResultClick}
      renderSearchTooltipContent={renderSearchTooltipContent}
      renderSearchBadge={(method) => <Badge type={mapToBadgeType(method)} />}
      leftContent={
        <MenuBar>
          <MenuBarItem title={t('menuBar.file')}>
            <MenuItem title={t('menuBar.new')} shortcut="Ctrl+N" onClick={handleMenuNew} />
            <MenuItemSeparator />
            <MenuItem title={t('menuBar.import')} shortcut="Ctrl+I" onClick={handleImport} />
            <MenuItemSeparator />
            <MenuItem title={t('menuBar.open')} shortcut="Ctrl+O" onClick={handleMenuOpen} />
            <MenuItem title={t('menuBar.openFolder')} onClick={handleMenuOpenFolder} />
            {fileName && (
              <>
                <MenuItemSeparator />
                <MenuItem title={t('menuBar.save')} shortcut="Ctrl+S" onClick={handleMenuSave} />
                <MenuItem title={t('menuBar.saveAs')} shortcut="Ctrl+Shift+S" onClick={handleMenuSaveAs} />
              </>
            )}
            {recentFiles.length > 0 && (
              <MenuItem title={t('menuBar.recentFiles')}>
                {recentFiles.slice(0, 10).map((file) => (
                  <MenuItem
                    key={file.path}
                    title={file.name}
                    onClick={() => { onOpenRecentFile(file.path) }}
                  />
                ))}
              </MenuItem>
            )}
            {favorites.length > 0 && (
              <MenuItem title={t('menuBar.favorites')}>
                {favorites.map((file) => (
                  <MenuItem
                    key={file.path}
                    title={file.name}
                    onClick={() => { onOpenRecentFile(file.path) }}
                  />
                ))}
              </MenuItem>
            )}
            {fileName && (
              <>
                <MenuItemSeparator />
                <MenuItem title={t('menuBar.close')} onClick={handleMenuClose} />
              </>
            )}
            <MenuItemSeparator />
            <MenuItem title={t('menuBar.exit')} shortcut="Ctrl+Q" onClick={handleMenuExit} />
          </MenuBarItem>
        </MenuBar>
      }
      rightContent={
        <Button
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
