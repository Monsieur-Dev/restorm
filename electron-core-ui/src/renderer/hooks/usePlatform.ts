export const isMacintosh = navigator.platform.toUpperCase().includes('MAC')

export const usePlatform = (): { isMacintosh: boolean; isWindows: boolean; isLinux: boolean } => {
  return {
    isMacintosh,
    isWindows: navigator.platform.toUpperCase().includes('WIN'),
    isLinux: navigator.platform.toUpperCase().includes('LINUX')
  }
}