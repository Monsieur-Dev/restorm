import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../Modal'
import { SettingsPage } from './SettingsPage'
import { SettingsModalContext, type SettingsModalContextValue } from './useSettingsModal'

interface SettingsModalProviderProps {
  children: React.ReactNode
}

/**
 * Provider component that enables settings modal functionality
 * Wrap your app with this to use useSettingsModal()
 */
export function SettingsModalProvider({ children }: SettingsModalProviderProps): React.ReactElement {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

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
        isOpen={isOpen}
        title={t('settings.title', 'Settings')}
        onClose={hideSettingsModal}
      >
        <SettingsPage />
      </Modal>
    </SettingsModalContext.Provider>
  )
}

export default SettingsModalProvider
