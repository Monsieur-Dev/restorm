import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../Modal'
import { SettingsPage } from './SettingsPage'
import { SettingsModalContext, type SettingsModalContextValue } from './useSettingsModal'

interface SettingsModalProviderProps {
  children: React.ReactNode
  /** Optional test id applied to the underlying Modal. Defaults to `settings-modal`. */
  'data-testid'?: string
  /** Optional test id applied to the SettingsPage. Defaults to `settings-page`. */
  settingsPageTestId?: string
}

/**
 * Provider component that enables settings modal functionality
 * Wrap your app with this to use useSettingsModal()
 */
export function SettingsModalProvider({
  children,
  'data-testid': dataTestId,
  settingsPageTestId
}: SettingsModalProviderProps): React.ReactElement {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const modalTestId = dataTestId ?? 'settings-modal'
  const pageTestId = settingsPageTestId ?? 'settings-page'

  const showSettingsModal = useCallback(() => {
    setIsOpen(true)
  }, [])

  const hideSettingsModal = useCallback(() => {
    setIsOpen(false)
  }, [])

  const value = useMemo<SettingsModalContextValue>(() => ({
    isOpen,
    showSettingsModal,
    hideSettingsModal
  }), [isOpen, showSettingsModal, hideSettingsModal])

  return (
    <SettingsModalContext.Provider value={value}>
      {children}
      <Modal
        data-testid={modalTestId}
        isOpen={isOpen}
        title={t('settings.title', 'Settings')}
        onClose={hideSettingsModal}
      >
        <SettingsPage data-testid={pageTestId} />
      </Modal>
    </SettingsModalContext.Provider>
  )
}
