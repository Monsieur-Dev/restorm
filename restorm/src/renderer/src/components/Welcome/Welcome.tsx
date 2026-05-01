import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileService, FilesPanel, RainbowButton, Wallpaper, Wordmark } from 'electron-core-ui/renderer'
import './Welcome.css'

interface WelcomeProps {
  onNew?: () => void
  onOpen?: () => void
}

/**
 * Empty-state landing of the workbench: a hero with the brand wordmark,
 * the two primary actions (New / Open), and a frosted FilesPanel
 * surfacing favorites and recent files.
 */
export const Welcome: React.FC<WelcomeProps> = ({ onNew, onOpen }) => {
  const { t } = useTranslation()
  const { recentFiles, favorites } = useFileService()
  const hasContent = recentFiles.length > 0 || favorites.length > 0

  const handleOpenFile = useCallback((path: string) => {
    // Use restorm:open-path which handles both files and folders
    void window.restorm?.file.openPath(path)
  }, [])

  const handleConfirmRemoveFavorite = useCallback((fileName: string) => {
    return window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))
  }, [t])

  return (
    <main
      className="welcome-container"
      role="main"
      aria-label={t('welcome.landmarkLabel')}
    >
      <Wallpaper pattern="random" />
      <header className="welcome-header">
        <h1 className="welcome-wordmark-heading">
          <span className="welcome-wordmark-visually-hidden">Restorm</span>
          <Wordmark
            effect="random"
            loop
            className="welcome-wordmark"
            aria-hidden="true"
          >
            Restorm
          </Wordmark>
        </h1>
        <div className="welcome-wordmark-rule" aria-hidden="true" />
      </header>
      <div className="welcome-content">
        <div className="welcome-actions">
          <RainbowButton
            size="xl"
            onClick={onNew}
            aria-label={t('welcome.newAriaLabel')}
            data-testid="welcome-new-button"
          >
            {t('welcome.new')}
          </RainbowButton>
          <RainbowButton
            size="xl"
            onClick={onOpen}
            aria-label={t('welcome.openAriaLabel')}
            data-testid="welcome-open-button"
          >
            {t('welcome.open')}
          </RainbowButton>
        </div>
        {!hasContent && (
          <p className="welcome-hint">
            {t('welcome.noFilesHint')}
          </p>
        )}
      </div>

      <FilesPanel
        onOpenFile={handleOpenFile}
        confirmRemoveFavorite={handleConfirmRemoveFavorite}
        className="welcome-files-panel"
      />
    </main>
  )
}

export default Welcome
