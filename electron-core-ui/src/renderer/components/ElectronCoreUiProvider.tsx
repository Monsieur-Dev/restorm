import React, { useEffect } from 'react'
import { ThemeProvider } from '../contexts'
import { SettingsProvider } from '../contexts/SettingsContext'
import type { CapabilityGate } from '../contexts/settingsContextDef'
import { SettingsModalProvider } from './Settings'
import { useSetting } from '../hooks/useSettings'
import { Workbench, type WorkbenchProps } from './Workbench/Workbench'

/** Toggles CSS classes on documentElement based on advancedVisualEffects setting */
const AdvancedEffectsManager: React.FC = () => {
  const [enabled] = useSetting('appearance:advancedVisualEffects')

  useEffect(() => {
    const root = document.documentElement
    if (enabled) {
      root.classList.add('ecu-advanced-effects')
      root.classList.remove('ecu-reduced-motion')
    } else {
      root.classList.remove('ecu-advanced-effects')
      root.classList.add('ecu-reduced-motion')
    }
    return () => {
      root.classList.remove('ecu-advanced-effects', 'ecu-reduced-motion')
    }
  }, [enabled])

  return null
}

export interface ElectronCoreUiProviderProps extends Omit<WorkbenchProps, 'children'> {
  children: React.ReactNode
  /** See {@link CapabilityGate}. Threaded down to `SettingsProvider` so a
   * `SettingDefinition.capability`-tagged setting can render greyed +
   * upsold in Community. Omit for a host with no capability/entitlement
   * concept — capability-tagged settings then simply render unlocked. */
  capabilityGate?: CapabilityGate | undefined
}

/**
 * High-level provider that wires core Electron UI context providers
 * and the workbench layout in a single component.
 *
 * It should be used once at the root of the renderer tree.
 */
export const ElectronCoreUiProvider: React.FC<ElectronCoreUiProviderProps> = ({
  children,
  capabilityGate,
  ...workbenchProps
}) => {
  return (
    <ThemeProvider>
      <SettingsProvider capabilityGate={capabilityGate}>
        <AdvancedEffectsManager />
        <SettingsModalProvider>
          <Workbench {...workbenchProps}>
            {children}
          </Workbench>
        </SettingsModalProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}
