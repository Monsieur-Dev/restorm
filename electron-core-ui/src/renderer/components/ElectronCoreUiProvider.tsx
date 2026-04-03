import React from 'react'
import type { ComponentType } from 'react'
import { ThemeProvider } from '../contexts'
import { SettingsProvider } from '../contexts/SettingsContext'
import { SettingsModalProvider } from './Settings'
import Workbench, { type WorkbenchProps } from './Workbench/Workbench'
import type { SettingRendererProps } from './Settings/renderers/types'

export interface ElectronCoreUiProviderProps extends Omit<WorkbenchProps, 'children'> {
  children: React.ReactNode
  customRenderers?: Record<string, ComponentType<SettingRendererProps>>
}

/**
 * High-level provider that wires core Electron UI context providers
 * and the workbench layout in a single component.
 *
 * It should be used once at the root of the renderer tree.
 */
export const ElectronCoreUiProvider: React.FC<ElectronCoreUiProviderProps> = ({
  children,
  customRenderers,
  ...workbenchProps
}) => {
  return (
    <ThemeProvider>
      <SettingsProvider customRenderers={customRenderers}>
        <SettingsModalProvider>
          <Workbench {...workbenchProps}>
            {children}
          </Workbench>
        </SettingsModalProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}

export default ElectronCoreUiProvider
