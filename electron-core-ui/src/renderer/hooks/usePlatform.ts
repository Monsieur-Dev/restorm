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

/** Platform flags are derived once at module load (the platform can't change
 * within a session). Frozen + shared so usePlatform() returns a STABLE
 * reference — returning a fresh object each call broke `===` memoization when
 * the result was placed in a hook dependency array. */
const PLATFORM_FLAGS: Readonly<{ isMacintosh: boolean; isWindows: boolean; isLinux: boolean }> = Object.freeze({
  isMacintosh,
  isWindows: platform.includes('WIN'),
  isLinux: platform.includes('LINUX')
})

export const usePlatform = (): { isMacintosh: boolean; isWindows: boolean; isLinux: boolean } => {
  return PLATFORM_FLAGS
}
