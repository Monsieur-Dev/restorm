import * as IconoirIcons from 'iconoir-react'
import * as PhosphorIcons from '@phosphor-icons/react'
import * as mdiPaths from '@mdi/js'
import * as simpleIcons from 'simple-icons'
import * as FeatherIcons from 'react-feather'
import * as FaSolidIcons from '@fortawesome/free-solid-svg-icons'
import * as FaBrandsIcons from '@fortawesome/free-brands-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

/**
 * Check if a value is a React component (function or forwardRef object)
 */
const isReactComponent = (value: unknown): boolean => {
  if (typeof value === 'function') return true
  if (typeof value === 'object' && value !== null) {
    // Check for forwardRef components (have $$typeof and render properties)
    const obj = value as Record<string, unknown>
    return '$$typeof' in obj || 'render' in obj
  }
  return false
}

// =============================================================================
// Iconoir Icons
// =============================================================================

/**
 * Get all Iconoir icon names (sorted alphabetically)
 */
export const getIconoirNames = (): string[] => {
  return Object.keys(IconoirIcons)
    .filter(key => /^[A-Z]/.test(key) && isReactComponent((IconoirIcons as Record<string, unknown>)[key]))
    .sort()
}

// =============================================================================
// Phosphor Icons
// =============================================================================

/**
 * Get all Phosphor icon names (sorted alphabetically)
 */
export const getPhosphorNames = (): string[] => {
  return Object.keys(PhosphorIcons)
    .filter(key => /^[A-Z]/.test(key) && !key.endsWith('Icon') && isReactComponent((PhosphorIcons as Record<string, unknown>)[key]))
    .sort()
}

// =============================================================================
// Material Design Icons (MDI)
// =============================================================================

/**
 * Get all MDI icon names (sorted alphabetically)
 */
export const getMdiNames = (): string[] => {
  return Object.keys(mdiPaths)
    .filter(key => key.startsWith('mdi') && typeof (mdiPaths as Record<string, unknown>)[key] === 'string')
    .sort()
}

// =============================================================================
// Simple Icons (Brand icons)
// =============================================================================

// Type for simple-icons entries
export interface SimpleIconEntry {
  title: string
  slug: string
  hex: string
  svg: string
}

/**
 * Get all Simple Icons slugs (sorted alphabetically)
 */
export const getSimpleIconsNames = (): string[] => {
  // simple-icons exports an object with icon slugs as keys
  return Object.keys(simpleIcons as Record<string, SimpleIconEntry>)
    .filter(key => key !== 'default')
    .sort()
}

/**
 * Get Simple Icons icon data by slug
 */
export const getSimpleIconData = (slug: string): SimpleIconEntry | null => {
  return (simpleIcons as Record<string, SimpleIconEntry>)[slug] ?? null
}

// =============================================================================
// Feather Icons
// =============================================================================

/**
 * Get all Feather icon names (sorted alphabetically)
 */
export const getFeatherNames = (): string[] => {
  return Object.keys(FeatherIcons)
    .filter(key => /^[A-Z]/.test(key) && isReactComponent((FeatherIcons as Record<string, unknown>)[key]))
    .sort()
}

// =============================================================================
// Font Awesome Icons
// =============================================================================

// Combine solid and brands icons
export const faAllIcons: Record<string, IconDefinition> = {
  ...(FaSolidIcons as unknown as Record<string, IconDefinition>),
  ...(FaBrandsIcons as unknown as Record<string, IconDefinition>),
}

/**
 * Get all Font Awesome icon names (sorted alphabetically)
 */
export const getFontAwesomeNames = (): string[] => {
  return Object.keys(faAllIcons)
    .filter(key => key.startsWith('fa') && typeof faAllIcons[key] === 'object' && 'icon' in faAllIcons[key])
    .sort()
}

// =============================================================================
// Icon Library Metadata
// =============================================================================

export interface IconLibrary {
  id: string
  name: string
  getNames: () => string[]
  searchable: boolean
}

export const ICON_LIBRARIES: IconLibrary[] = [
  { id: 'iconoir', name: 'Iconoir', getNames: getIconoirNames, searchable: true },
  { id: 'phosphor', name: 'Phosphor', getNames: getPhosphorNames, searchable: true },
  { id: 'material', name: 'Material', getNames: getMdiNames, searchable: true },
  { id: 'simpleicons', name: 'Simple Icons', getNames: getSimpleIconsNames, searchable: true },
  { id: 'feather', name: 'Feather', getNames: getFeatherNames, searchable: true },
  { id: 'fontawesome', name: 'Font Awesome', getNames: getFontAwesomeNames, searchable: true },
]
