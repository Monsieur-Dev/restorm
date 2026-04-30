import React, { useCallback } from 'react'
import { ThemeCarousel } from '../ThemeCarousel'
import type { SettingRendererProps } from './types'

/**
 * Wraps ThemeCarousel and routes the user's selection through the
 * scope-aware `onChange` callback the SettingItem provides. Without
 * this the carousel called `window.api.theme.set` directly and
 * bypassed the Workspace overlay (the user could pick a theme from
 * the Workspace tab and it'd never land in
 * `<dir>/.restorm/settings.json`).
 */
export const ThemeRenderer: React.FC<SettingRendererProps> = ({ onChange }) => {
  const handleSelect = useCallback((themeId: string) => {
    onChange(themeId)
  }, [onChange])
  return <ThemeCarousel onSelect={handleSelect} />
}
