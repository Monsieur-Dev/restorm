export * from './WindowManager'
export * from './BaseWindow'
export { setupIPC, setupAppLifecycle, initializeApp, configureCommandLineSwitches, setupAppProtocol } from './IPCManager'
export type { InitializeAppOptions } from './IPCManager'
// The app-icon menu handler is registered by the host rather than by
// `setupIPC`: it only makes sense once the host has created the
// AppIconMenuService, which not every host does.
export { registerAppIconMenuHandlers } from './ipc'
export { createSplashWindow } from './SplashWindow'
export type { SplashWindowOptions, SplashWindowHandle } from './SplashWindow'
