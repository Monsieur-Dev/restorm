import type { ComponentType } from 'react'
import type { SettingRendererProps } from './types'

const customRenderers = new Map<string, ComponentType<SettingRendererProps>>()

/**
 * Register a custom setting renderer for a given type.
 * Call this before rendering the app (e.g. in main.tsx).
 *
 * The type must match the `type` field in the YAML settings config
 * and the `renderers` section mapping.
 */
export function registerSettingRenderer(type: string, component: ComponentType<SettingRendererProps>): void {
  customRenderers.set(type, component)
}

/**
 * Unregister a custom setting renderer.
 */
export function unregisterSettingRenderer(type: string): void {
  customRenderers.delete(type)
}

/**
 * Get a registered custom renderer by type.
 */
export function getCustomRenderer(type: string): ComponentType<SettingRendererProps> | undefined {
  return customRenderers.get(type)
}
