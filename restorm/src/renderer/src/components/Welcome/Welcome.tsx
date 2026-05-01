import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileService, Button, RainbowButton, Wallpaper, Vignette, Wordmark } from 'electron-core-ui/renderer'
import './Welcome.css'

const splitPath = (fullPath: string): { directory: string; basename: string } => {
  const lastSep = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
  if (lastSep < 0) return { directory: '', basename: fullPath }
  return {
    directory: fullPath.slice(0, lastSep),
    basename: fullPath.slice(lastSep + 1)
  }
}

interface WelcomeProps {
  onNew?: () => void
  onOpen?: () => void
}

/**
 * Empty-state landing of the workbench: a hero with the brand wordmark,
 * the two primary actions (New / Open), and a frosted panel surfacing
 * favorites and recent files.
 */
export const Welcome: React.FC<WelcomeProps> = ({ onNew, onOpen }) => {
  const { t } = useTranslation()
  const {
    recentFiles,
    favorites,
    toggleFavorite
  } = useFileService()

  const handleOpenFile = useCallback((path: string) => {
    // Use restorm:open-path which handles both files and folders
    void window.restorm?.file.openPath(path)
  }, [])

  const handleToggleFavorite = useCallback((path: string, fileName: string, isCurrentlyFavorite: boolean, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent opening the file
    if (isCurrentlyFavorite) {
      const confirmed = window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))
      if (!confirmed) return
    }
    void toggleFavorite(path)
  }, [toggleFavorite, t])

  const handleRemoveFavorite = useCallback((path: string, fileName: string, event: React.MouseEvent) => {
    event.stopPropagation()
    const confirmed = window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))
    if (confirmed) {
      void toggleFavorite(path)
    }
  }, [toggleFavorite, t])

  const isFavorite = useCallback((path: string): boolean => {
    return favorites.some(f => f.path === path)
  }, [favorites])

  const hasFavorites = favorites.length > 0
  const hasRecents = recentFiles.length > 0
  const hasContent = hasFavorites || hasRecents

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

      {hasContent && (
        <Vignette decoration="random" className="welcome-files-panel">
          {hasFavorites && (
            <section
              className="welcome-section"
              aria-label={t('welcome.favoritesLandmarkLabel')}
            >
              <h3 className="welcome-section-title">
                <i className="codicon codicon-star-full welcome-section-icon favorite" aria-hidden="true" />
                {t('welcome.favorites')}
              </h3>
              <ul className="welcome-file-list">
                {favorites.map((file) => (
                  <li
                    key={file.path}
                    className="welcome-file-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => { handleOpenFile(file.path) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenFile(file.path) } }}
                  >
                    <span className="welcome-file-name">{splitPath(file.path).basename}</span>
                    <span className="welcome-file-path">{splitPath(file.path).directory}</span>
                    <Button
                      icon="star-full"
                      small
                      secondary
                      className="welcome-favorite-btn is-favorite"
                      onClick={(e) => { handleRemoveFavorite(file.path, file.name, e) }}
                      options={{ title: t('welcome.removeFromFavorites'), ariaLabel: t('welcome.removeFromFavorites') }}
                      data-testid="remove-favorite-button"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasRecents && (
            <section
              className="welcome-section"
              aria-label={t('welcome.recentsLandmarkLabel')}
            >
              <h3 className="welcome-section-title">
                <i className="codicon codicon-history welcome-section-icon" aria-hidden="true" />
                {t('welcome.recentFiles')}
              </h3>
              <ul className="welcome-file-list">
                {recentFiles.map((file) => (
                  <li
                    key={file.path}
                    className="welcome-file-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => { handleOpenFile(file.path) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenFile(file.path) } }}
                  >
                    <span className="welcome-file-name">{splitPath(file.path).basename}</span>
                    <span className="welcome-file-path">{splitPath(file.path).directory}</span>
                    <Button
                      icon={isFavorite(file.path) ? 'star-full' : 'star-empty'}
                      small
                      secondary
                      className={`welcome-favorite-btn ${isFavorite(file.path) ? 'is-favorite' : ''}`}
                      onClick={(e) => { handleToggleFavorite(file.path, file.name, isFavorite(file.path), e) }}
                      options={{
                        title: isFavorite(file.path) ? t('welcome.removeFromFavorites') : t('welcome.addToFavorites'),
                        ariaLabel: isFavorite(file.path) ? t('welcome.removeFromFavorites') : t('welcome.addToFavorites')
                      }}
                      data-testid="toggle-favorite-button"
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </Vignette>
      )}
    </main>
  )
}

export default Welcome
