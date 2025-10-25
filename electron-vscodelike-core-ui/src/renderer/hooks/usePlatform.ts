export const isMacintosh = navigator.platform.toUpperCase().indexOf('MAC') >= 0

export const usePlatform = () => {
  return {
    isMacintosh,
    isWindows: navigator.platform.toUpperCase().indexOf('WIN') >= 0,
    isLinux: navigator.platform.toUpperCase().indexOf('LINUX') >= 0
  }
}