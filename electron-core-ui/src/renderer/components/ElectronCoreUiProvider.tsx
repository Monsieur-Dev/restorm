import React from 'react'
import { ThemeProvider } from '../contexts'
import { SettingsModalProvider } from './Settings'
import MonacoWorkbench, { type MonacoWorkbenchProps } from './MonacoWorkbench'

export interface ElectronCoreUiProviderProps extends Omit<MonacoWorkbenchProps, 'children'> {
  children: React.ReactNode
}

/**
 * High-level provider that wires core Electron UI context providers
 * and the Monaco workbench layout in a single component.
 *
 * It should be used once at the root of the renderer tree.
 */
export const ElectronCoreUiProvider: React.FC<ElectronCoreUiProviderProps> = ({
  children,
  ...monacoProps
}) => {
  return (
    <ThemeProvider>
      <SettingsModalProvider>
        <MonacoWorkbench {...monacoProps}>
          {children}
        </MonacoWorkbench>
      </SettingsModalProvider>
    </ThemeProvider>
  )
}

export default ElectronCoreUiProvider



