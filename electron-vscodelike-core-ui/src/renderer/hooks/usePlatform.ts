import { useState, useEffect } from 'react'

export type Platform = 'mac' | 'windows' | 'linux' | 'web'

export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>('web')

  useEffect(() => {
    const detectPlatform = (): Platform => {
      // Check if we're in a browser environment
      if (typeof window === 'undefined') {
        return 'web'
      }

      // Check if we're in Electron
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userAgent = (window.navigator as any).userAgentData?.platform || window.navigator.platform
      
      // Try to get platform from process (Electron)
      if (typeof process !== 'undefined' && process.platform) {
        switch (process.platform) {
          case 'darwin':
            return 'mac'
          case 'win32':
            return 'windows'
          case 'linux':
            return 'linux'
          default:
            return 'web'
        }
      }

      // Fallback to userAgent detection
      if (userAgent) {
        const platform = userAgent.toLowerCase()
        if (platform.includes('mac')) {
          return 'mac'
        } else if (platform.includes('win')) {
          return 'windows'
        } else if (platform.includes('linux')) {
          return 'linux'
        }
      }

      return 'web'
    }

    setPlatform(detectPlatform())
  }, [])

  return platform
}

