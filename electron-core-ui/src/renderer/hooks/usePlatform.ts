// Use userAgentData when available, fallback to userAgent parsing
const getPlatform = (): string => {
  const nav = navigator as { userAgentData?: { platform?: string } }
  if (nav.userAgentData?.platform) {
    return nav.userAgentData.platform.toUpperCase()
  }
  // Fallback to userAgent parsing
  const ua = navigator.userAgent.toUpperCase()
  if (ua.includes('MAC')) return 'MAC'
  if (ua.includes('WIN')) return 'WINDOWS'
  if (ua.includes('LINUX')) return 'LINUX'
  return 'UNKNOWN'
}

const platform = getPlatform()

export const isMacintosh = platform.includes('MAC')

export const usePlatform = (): { isMacintosh: boolean; isWindows: boolean; isLinux: boolean } => {
  return {
    isMacintosh,
    isWindows: platform.includes('WIN'),
    isLinux: platform.includes('LINUX')
  }
}
