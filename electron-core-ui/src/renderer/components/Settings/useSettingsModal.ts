import { useContext, createContext } from 'react'

/**
 * Context value for settings modal
 */
export interface SettingsModalContextValue {
  /** Whether the settings modal is currently open */
  isOpen: boolean
  /** Open the settings modal */
  showSettingsModal: () => void
  /** Close the settings modal */
  hideSettingsModal: () => void
}

export const SettingsModalContext = createContext<SettingsModalContextValue | null>(null)

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
