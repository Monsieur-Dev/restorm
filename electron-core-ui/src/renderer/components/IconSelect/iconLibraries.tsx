/* eslint-disable react-refresh/only-export-components */
import React, { memo } from 'react'
import * as IconoirIcons from 'iconoir-react'
import * as PhosphorIcons from '@phosphor-icons/react'
import * as mdiPaths from '@mdi/js'
import * as simpleIcons from 'simple-icons'
import * as FeatherIcons from 'react-feather'
import * as FaSolidIcons from '@fortawesome/free-solid-svg-icons'
import * as FaBrandsIcons from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

// =============================================================================
// Iconoir Icons
// =============================================================================

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

/**
 * Get all Iconoir icon names (sorted alphabetically)
 */
export const getIconoirNames = (): string[] => {
  return Object.keys(IconoirIcons)
    .filter(key => /^[A-Z]/.test(key) && isReactComponent((IconoirIcons as Record<string, unknown>)[key]))
    .sort()
}

/**
 * Render an Iconoir icon by name
 */
export const IconoirIcon: React.FC<{ name: string; size?: number; className?: string }> = memo(({ name, size = 16, className }) => {
  const IconComponent = (IconoirIcons as unknown as Record<string, React.ComponentType<{ width?: number; height?: number; className?: string }>>)[name]
  if (!IconComponent) return null
  const props: { width: number; height: number; className?: string } = { width: size, height: size }
  if (className) props.className = className
  return <IconComponent {...props} />
})
IconoirIcon.displayName = 'IconoirIcon'

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

/**
 * Render a Phosphor icon by name
 */
export const PhosphorIcon: React.FC<{ name: string; size?: number; className?: string }> = memo(({ name, size = 16, className }) => {
  const IconComponent = (PhosphorIcons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[name]
  if (!IconComponent) return null
  const props: { size: number; className?: string } = { size }
  if (className) props.className = className
  return <IconComponent {...props} />
})
PhosphorIcon.displayName = 'PhosphorIcon'

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

/**
 * Render an MDI icon by name (using SVG path)
 */
export const MdiIcon: React.FC<{ name: string; size?: number; className?: string }> = memo(({ name, size = 16, className }) => {
  const path = (mdiPaths as Record<string, string>)[name]
  if (!path) return null
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d={path} />
    </svg>
  )
})
MdiIcon.displayName = 'MdiIcon'

// =============================================================================
// Simple Icons (Brand icons)
// =============================================================================

// Type for simple-icons entries
interface SimpleIconEntry {
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

/**
 * Render a Simple Icons icon by slug
 */
export const SimpleIcon: React.FC<{ name: string; size?: number; className?: string; useOriginalColor?: boolean }> = memo(({ 
  name, 
  size = 16, 
  className,
  useOriginalColor = false 
}) => {
  const iconData = getSimpleIconData(name)
  if (!iconData) return null
  
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={useOriginalColor ? `#${iconData.hex}` : 'currentColor'}
      dangerouslySetInnerHTML={{ __html: iconData.svg }}
    />
  )
})
SimpleIcon.displayName = 'SimpleIcon'

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

/**
 * Render a Feather icon by name
 */
export const FeatherIcon: React.FC<{ name: string; size?: number; className?: string }> = memo(({ name, size = 16, className }) => {
  const IconComponent = (FeatherIcons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[name]
  if (!IconComponent) return null
  const props: { size: number; className?: string } = { size }
  if (className) props.className = className
  return <IconComponent {...props} />
})
FeatherIcon.displayName = 'FeatherIcon'

// =============================================================================
// Font Awesome Icons
// =============================================================================

// Combine solid and brands icons
const faAllIcons: Record<string, IconDefinition> = {
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

/**
 * Render a Font Awesome icon by name
 */
export const FaIcon: React.FC<{ name: string; size?: number; className?: string }> = memo(({ name, size = 16, className }) => {
  const iconDef = faAllIcons[name]
  if (!iconDef) return null
  return <FontAwesomeIcon icon={iconDef} style={{ width: size, height: size }} className={className} />
})
FaIcon.displayName = 'FaIcon'

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

// =============================================================================
// Utility: Render icon based on type
// =============================================================================

export const renderLibraryIcon = (
  type: string,
  name: string,
  size = 16,
  className?: string
): React.ReactNode => {
  const classNameProp = className ? { className } : {}
  switch (type) {
    case 'iconoir':
      return <IconoirIcon name={name} size={size} {...classNameProp} />
    case 'phosphor':
      return <PhosphorIcon name={name} size={size} {...classNameProp} />
    case 'material':
      return <MdiIcon name={name} size={size} {...classNameProp} />
    case 'simpleicons':
      return <SimpleIcon name={name} size={size} {...classNameProp} />
    case 'feather':
      return <FeatherIcon name={name} size={size} {...classNameProp} />
    case 'fontawesome':
      return <FaIcon name={name} size={size} {...classNameProp} />
    default:
      return null
  }
}
