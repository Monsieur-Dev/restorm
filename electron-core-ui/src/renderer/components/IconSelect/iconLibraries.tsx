import React, { memo } from 'react'
import * as IconoirIcons from 'iconoir-react'
import * as PhosphorIcons from '@phosphor-icons/react'
import * as mdiPaths from '@mdi/js'
import * as FeatherIcons from 'react-feather'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { getSimpleIconData, faAllIcons } from './iconLibraryUtils'

// =============================================================================
// Icon Components
// =============================================================================

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

/**
 * Render a Font Awesome icon by name
 */
export const FaIcon: React.FC<{ name: string; size?: number; className?: string }> = memo(({ name, size = 16, className }) => {
  const iconDef = faAllIcons[name]
  if (!iconDef) return null
  return <FontAwesomeIcon icon={iconDef} style={{ width: size, height: size }} className={className} />
})
FaIcon.displayName = 'FaIcon'

/**
 * Render icon based on library type
 */
export const RenderLibraryIcon: React.FC<{ type: string; name: string; size?: number; className?: string }> = memo(({
  type,
  name,
  size = 16,
  className
}) => {
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
})
RenderLibraryIcon.displayName = 'RenderLibraryIcon'
