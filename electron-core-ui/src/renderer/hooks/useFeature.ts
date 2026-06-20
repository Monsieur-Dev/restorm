import { useState, useEffect } from 'react'
import type { FeaturePlatform } from '../../types/feature'

interface WindowApi {
  feature: {
    isEnabled: (featureName: string) => Promise<boolean>
    getPlatform: () => Promise<FeaturePlatform>
  }
}

/** The feature bridge off `window.api`, or undefined when it isn't injected
 * (web mode / preload not ready). Centralises the `window as …` access that was
 * repeated (non-optionally) at four call sites. */
function getFeatureApi(): WindowApi['feature'] | undefined {
  return (window as unknown as { api?: WindowApi }).api?.feature
}

/**
 * Hook to check if a feature is enabled
 * @param featureName - The name of the feature to check
 * @returns Object containing the enabled state and loading state
 */
export const useFeature = (featureName: string): { isEnabled: boolean; isLoading: boolean } => {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const checkFeature = async (): Promise<void> => {
      try {
        const feature = getFeatureApi()
        const enabled = (await feature?.isEnabled(featureName)) ?? false
        if (mounted) {
          setIsEnabled(enabled)
          setIsLoading(false)
        }
      } catch {
        if (mounted) {
          setIsEnabled(false)
          setIsLoading(false)
        }
      }
    }

    void checkFeature()

    return () => {
      mounted = false
    }
  }, [featureName])

  return { isEnabled, isLoading }
}

/**
 * Hook to get the current runtime platform
 * @returns Object containing the platform and loading state
 */
export const usePlatformFeature = (): { platform: FeaturePlatform; isLoading: boolean } => {
  const [platform, setPlatform] = useState<FeaturePlatform>('desktop')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const getPlatform = async (): Promise<void> => {
      try {
        const feature = getFeatureApi()
        const p = (await feature?.getPlatform()) ?? 'web'
        if (mounted) {
          setPlatform(p)
          setIsLoading(false)
        }
      } catch {
        if (mounted) {
          setPlatform('web')
          setIsLoading(false)
        }
      }
    }

    void getPlatform()

    return () => {
      mounted = false
    }
  }, [])

  return { platform, isLoading }
}

/**
 * Hook to check if the app is running in desktop platform
 * @returns Object containing isDesktop flag and loading state
 */
export const useIsDesktop = (): { isDesktop: boolean; isLoading: boolean } => {
  const { platform, isLoading } = usePlatformFeature()
  return { isDesktop: platform === 'desktop', isLoading }
}

/**
 * Utility function to check feature status imperatively (not a hook)
 * @param featureName - The name of the feature to check
 * @returns Promise resolving to boolean indicating if feature is enabled
 */
export const checkFeature = async (featureName: string): Promise<boolean> => {
  try {
    return (await getFeatureApi()?.isEnabled(featureName)) ?? false
  } catch {
    return false
  }
}

/**
 * Utility function to get the current platform imperatively (not a hook)
 * @returns Promise resolving to the current platform
 */
export const getPlatform = async (): Promise<FeaturePlatform> => {
  try {
    return (await getFeatureApi()?.getPlatform()) ?? 'web'
  } catch {
    return 'web'
  }
}
