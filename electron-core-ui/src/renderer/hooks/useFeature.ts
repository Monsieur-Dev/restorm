import { useState, useEffect, useCallback } from 'react'
import type { FeaturePlatform } from '../../types/feature'

interface WindowApi {
  feature: {
    isEnabled: (featureName: string) => Promise<boolean>
    getPlatform: () => Promise<FeaturePlatform>
    onChanged?: (callback: () => void) => () => void
  }
}

/** The feature bridge off `window.api`, or undefined when it isn't injected
 * (web mode / preload not ready). Centralises the `window as …` access that was
 * repeated (non-optionally) at four call sites. */
function getFeatureApi(): WindowApi['feature'] | undefined {
  return (window as unknown as { api?: WindowApi }).api?.feature
}

/**
 * Hook to check if a feature is enabled.
 *
 * Queries the main process on mount, then re-evaluates whenever the main
 * process pushes a `feature:changed` notification (e.g. after an entitlement
 * refresh triggered by login / logout / token renewal). Components re-render
 * automatically — no app restart required.
 *
 * @param featureName - The name of the feature to check
 * @returns Object containing the enabled state and loading state
 */
export const useFeature = (featureName: string): { isEnabled: boolean; isLoading: boolean } => {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const checkFeature = useCallback(async (): Promise<void> => {
    try {
      const feature = getFeatureApi()
      const enabled = (await feature?.isEnabled(featureName)) ?? false
      setIsEnabled(enabled)
      setIsLoading(false)
    } catch {
      setIsEnabled(false)
      setIsLoading(false)
    }
  }, [featureName])

  // Initial fetch + subscribe to main-process invalidation events.
  useEffect(() => {
    let mounted = true

    const check = async (): Promise<void> => {
      if (!mounted) return
      await checkFeature()
    }

    void check()

    // Re-fetch whenever the feature service signals a state change (e.g. an
    // entitlement refresh flipped a custom strategy's outcome).
    const unsubscribe = getFeatureApi()?.onChanged?.(() => {
      if (mounted) void check()
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [checkFeature])

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
