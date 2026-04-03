/**
 * Type of icon (emoji character, codicon name, library icons, or no icon)
 */
export type IconType = 'emoji' | 'codicon' | 'iconoir' | 'phosphor' | 'material' | 'simpleicons' | 'feather' | 'fontawesome' | 'none'

/**
 * Represents an icon that can be an emoji, codicon, or an icon from supported libraries
 */
export interface Icon {
  /** The type of icon */
  type: IconType
  /** The icon value - emoji character for 'emoji', icon name for library icons, empty for 'none' */
  value: string
}

/**
 * Create an emoji icon
 */
export function emojiIcon(emoji: string): Icon {
  return { type: 'emoji', value: emoji }
}

/**
 * Create a codicon icon
 */
export function codiconIcon(name: string): Icon {
  return { type: 'codicon', value: name }
}

/**
 * Create an Iconoir icon
 */
export function iconoirIcon(name: string): Icon {
  return { type: 'iconoir', value: name }
}

/**
 * Create a Phosphor icon
 */
export function phosphorIcon(name: string): Icon {
  return { type: 'phosphor', value: name }
}

/**
 * Create a Material icon
 */
export function materialIcon(name: string): Icon {
  return { type: 'material', value: name }
}

/**
 * Create a Simple Icons icon
 */
export function simpleIcon(name: string): Icon {
  return { type: 'simpleicons', value: name }
}

/**
 * Create a Feather icon
 */
export function featherIcon(name: string): Icon {
  return { type: 'feather', value: name }
}

/**
 * Create a Font Awesome icon
 */
export function fontAwesomeIcon(name: string): Icon {
  return { type: 'fontawesome', value: name }
}

/**
 * Create an empty icon (no icon)
 */
export function noIcon(): Icon {
  return { type: 'none', value: '' }
}
