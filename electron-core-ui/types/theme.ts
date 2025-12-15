/**
 * VSCode Theme Types
 * Based on the official VSCode theme format
 */

export interface TokenColorSettings {
  foreground?: string
  background?: string
  fontStyle?: string
}

export interface TokenColor {
  name?: string
  scope?: string | string[]
  settings: TokenColorSettings
}

export type ThemeColors = Record<string, string>

export type SemanticTokenColors = Record<string, string>

export interface ThemeDefinition {
  $schema?: string
  name: string
  type?: 'dark' | 'light' | 'hcDark' | 'hcLight'
  include?: string
  colors?: ThemeColors
  tokenColors?: TokenColor[]
  semanticTokenColors?: SemanticTokenColors
  semanticHighlighting?: boolean
}

export interface ThemeInfo {
  id: string
  name: string
  type: 'dark' | 'light' | 'hcDark' | 'hcLight'
  path: string
}

export type ThemeVariables = Record<string, string>
