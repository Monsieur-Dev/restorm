import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeature } from 'electron-core-ui/renderer'
import {
  handlebarsHelpersDefinitions,
  type TranslatedHelperDefinition
} from '../utils/handlebarsHelpersDefinitions'
import { registerHandlebarsHelpers } from '../utils/handlebarsHelpers'

/**
 * Hook that returns Handlebars helper definitions with translated descriptions
 * Helpers are sorted by category for better organization in autocomplete
 * Returns empty array if handlebars-helpers feature flag is disabled
 */
export function useHandlebarsHelpers(): TranslatedHelperDefinition[] {
  const { t } = useTranslation()
  const { isEnabled, isLoading } = useFeature('handlebars-helpers')

  // Register helpers when feature is enabled
  useEffect(() => {
    if (isEnabled && !isLoading) {
      registerHandlebarsHelpers()
    }
  }, [isEnabled, isLoading])

  return useMemo(() => {
    // Return empty array if feature is disabled or loading
    if (!isEnabled || isLoading) {
      return []
    }

    return handlebarsHelpersDefinitions.map((h) => {
      const result: TranslatedHelperDefinition = {
        name: h.name,
        category: t(`helpers.categories.${h.category}`),
        description: t(`helpers.${h.name}`),
        syntax: h.syntax
      }
      if (h.example) {
        result.example = h.example
      }
      return result
    })
  }, [t, isEnabled, isLoading])
}
