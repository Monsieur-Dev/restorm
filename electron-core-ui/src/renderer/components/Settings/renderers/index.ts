import type { ComponentType } from 'react'
import { ToggleRenderer } from './ToggleRenderer'
import { NumberInput } from './NumberInput'
import { TextInput } from './TextInput'
import { EnumRenderer } from './EnumRenderer'
import { ThemeRenderer } from './ThemeRenderer'
import type { SettingRendererProps } from './types'

export type { SettingRendererProps } from './types'

const builtinRenderers = new Map<string, ComponentType<SettingRendererProps>>([
  ['toggle', ToggleRenderer],
  ['number', NumberInput],
  ['text', TextInput],
  ['enum', EnumRenderer],
  ['theme', ThemeRenderer]
])

export function getRenderer(type: string): ComponentType<SettingRendererProps> | undefined {
  return builtinRenderers.get(type)
}

export { ToggleRenderer, NumberInput, TextInput, EnumRenderer, ThemeRenderer }
