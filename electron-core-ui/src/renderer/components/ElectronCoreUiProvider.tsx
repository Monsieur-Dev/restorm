import React from 'react'
import { ThemeProvider } from '../contexts'
import { SettingsModalProvider } from './Settings'
import Workbench, { type WorkbenchProps } from './Workbench/Workbench'

export interface ElectronCoreUiProviderProps extends Omit<WorkbenchProps, 'children'> {
  children: React.ReactNode
  /** Additional settings content rendered in the settings modal below theme/language */
  additionalSettingsContent?: React.ReactNode
}

/**
 * High-level provider that wires core Electron UI context providers
 * and the workbench layout in a single component.
 *
 * It should be used once at the root of the renderer tree.
 */
export const ElectronCoreUiProvider: React.FC<ElectronCoreUiProviderProps> = ({
  children,
  additionalSettingsContent,
  ...workbenchProps
}) => {
  return (
    <ThemeProvider>
      <SettingsModalProvider additionalSettingsContent={additionalSettingsContent}>
        <Workbench {...workbenchProps}>
          {children}
        </Workbench>
      </SettingsModalProvider>
    </ThemeProvider>
  )
}

export default ElectronCoreUiProvider
