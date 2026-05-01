import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RainbowButton, WelcomeScreen } from 'electron-core-ui/renderer'

interface WelcomeProps {
  onNew?: () => void
  onOpen?: () => void
}

/**
 * Restorm-flavoured wrapper around ECUI's `WelcomeScreen`. The shared
 * empty-state surface (wallpaper / wordmark / files panel) lives in
 * the ECUI component; this file only injects the brand name, the New
 * and Open CTAs, and the localized confirm / hint copy.
 */
export const Welcome: React.FC<WelcomeProps> = ({ onNew, onOpen }) => {
  const { t } = useTranslation()

  const handleOpenFile = useCallback((path: string) => {
    void window.restorm?.file.openPath(path)
  }, [])

  const handleConfirmRemoveFavorite = useCallback((fileName: string) => {
    return window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))
  }, [t])

  return (
    <WelcomeScreen
      name="Restorm"
      ariaLabel={t('welcome.landmarkLabel')}
      onOpenFile={handleOpenFile}
      confirmRemoveFavorite={handleConfirmRemoveFavorite}
      emptyStateHint={t('welcome.noFilesHint')}
    >
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
    </WelcomeScreen>
  )
}

export default Welcome
