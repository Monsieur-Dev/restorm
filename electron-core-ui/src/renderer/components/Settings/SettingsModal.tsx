import React, { useState, useCallback, createContext, useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../Modal'
import { SettingsPage } from './SettingsPage'

/**
 * Context value for settings modal
 */
interface SettingsModalContextValue {
  /** Whether the settings modal is currently open */
  isOpen: boolean
  /** Open the settings modal */
  showSettingsModal: () => void
  /** Close the settings modal */
  hideSettingsModal: () => void
}

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null)

/**
 * Hook to access settings modal functions
 * Must be used within a SettingsModalProvider
 */
export function useSettingsModal(): SettingsModalContextValue {
  const context = useContext(SettingsModalContext)
  if (!context) {
    throw new Error('useSettingsModal must be used within a SettingsModalProvider')
  }
  return context
}

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

