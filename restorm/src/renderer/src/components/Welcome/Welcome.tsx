import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileService, Button } from 'electron-core-ui/renderer'
import './Welcome.css'

/**
 * Welcome component displayed when no tabs are open in the workbench
 * Shows favorites and recent files lists
 */
export const Welcome: React.FC = () => {
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
    // Ask for confirmation when removing from favorites
    if (isCurrentlyFavorite) {
      const confirmed = window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))
      if (!confirmed) return
    }
    void toggleFavorite(path)
  }, [toggleFavorite, t])

  const handleRemoveFavorite = useCallback((path: string, fileName: string, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent opening the file
    // Ask for confirmation before removing from favorites
    const confirmed = window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))
    if (confirmed) {
      void toggleFavorite(path)
    }
  }, [toggleFavorite, t])

  // Check if a file is in favorites
  const isFavorite = useCallback((path: string): boolean => {
    return favorites.some(f => f.path === path)
  }, [favorites])

  const hasContent = favorites.length > 0 || recentFiles.length > 0

  return (
    <div className="welcome-container">
      <div className="welcome-content">
        <img 
          src="/imgs/logo_400.png" 
          alt="Restorm" 
          className="welcome-logo"
        />
        
        {hasContent ? (
          <div className="welcome-lists">
            {/* Favorites section */}
            {favorites.length > 0 && (
              <div className="welcome-section">
                <h3 className="welcome-section-title">
                  <i className="codicon codicon-star-full welcome-section-icon favorite" />
                  {t('welcome.favorites')}
                </h3>
                <ul className="welcome-file-list">
                  {favorites.map((file) => (
                    <li 
                      key={file.path}
                      className="welcome-file-item"
                      onClick={() => { handleOpenFile(file.path) }}
                    >
                      <i className="codicon codicon-file welcome-file-icon" />
                      <span className="welcome-file-name">{file.name}</span>
                      <span className="welcome-file-path">{file.path}</span>
                      <Button
                        icon="star-full"
                        small
                        secondary
                        className="welcome-favorite-btn is-favorite"
                        onClick={(e) => { handleRemoveFavorite(file.path, file.name, e) }}
                        options={{ title: t('welcome.removeFromFavorites') }}
                        data-testid="remove-favorite-button"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recent files section */}
            {recentFiles.length > 0 && (
              <div className="welcome-section">
                <h3 className="welcome-section-title">
                  <i className="codicon codicon-history welcome-section-icon" />
                  {t('welcome.recentFiles')}
                </h3>
                <ul className="welcome-file-list">
                  {recentFiles.map((file) => (
                    <li 
                      key={file.path}
                      className="welcome-file-item"
                      onClick={() => { handleOpenFile(file.path) }}
                    >
                      <i className="codicon codicon-file welcome-file-icon" />
                      <span className="welcome-file-name">{file.name}</span>
                      <span className="welcome-file-path">{file.path}</span>
                      <Button
                        icon={isFavorite(file.path) ? 'star-full' : 'star-empty'}
                        small
                        secondary
                        className={`welcome-favorite-btn ${isFavorite(file.path) ? 'is-favorite' : ''}`}
                        onClick={(e) => { handleToggleFavorite(file.path, file.name, isFavorite(file.path), e) }}
                        options={{ 
                          title: isFavorite(file.path) ? t('welcome.removeFromFavorites') : t('welcome.addToFavorites') 
                        }}
                        data-testid="toggle-favorite-button"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="welcome-hint">
            {t('welcome.noFilesHint')}
          </p>
        )}
      </div>
    </div>
  )
}

export default Welcome
