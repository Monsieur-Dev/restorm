// Renderer process exports
export * from './components'
export { MessageType, onWorkbenchTabDropped } from './components'
export { ElectronCoreUiProvider } from './components/ElectronCoreUiProvider'
export type { ElectronCoreUiProviderProps } from './components/ElectronCoreUiProvider'
export * from './hooks'
export type { UseThemeReturn } from './hooks/useTheme'
export * from './contexts'
export type { ThemeContextValue } from './contexts'
export * from './services'
export { initializeI18n, default as i18n } from './i18n'
export type { ThemeInfo, ThemeDefinition, ThemeVariables } from '../../types/theme'

