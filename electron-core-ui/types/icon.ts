/**
 * Type of icon (emoji character, codicon name, or no icon)
 */
export type IconType = 'emoji' | 'codicon' | 'none'

/**
 * Represents an icon that can be either an emoji or a codicon
 */
export interface Icon {
  /** The type of icon */
  type: IconType
  /** The icon value - emoji character for 'emoji', codicon name for 'codicon', empty for 'none' */
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
 * Create an empty icon (no icon)
 */
export function noIcon(): Icon {
  return { type: 'none', value: '' }
}

