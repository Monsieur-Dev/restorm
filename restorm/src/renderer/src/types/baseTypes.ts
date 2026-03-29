import type { RuntimeId } from 'electron-core-ui/types'
import type { ValueType } from './valueTypes'

export type { RuntimeId }

export type IconType =
  | 'emoji'
  | 'codicon'
  | 'iconoir'
  | 'phosphor'
  | 'material'
  | 'simpleicons'
  | 'feather'
  | 'fontawesome'
  | 'none'

export interface Icon {
  type: IconType
  value: string
}

export interface KeyValue {
  id?: RuntimeId | undefined
  key: string
  value: ValueType
  description?: string | undefined
  enabled?: boolean | undefined
}

export interface Environment {
  id: RuntimeId
  name: string
  icon?: Icon
  variables: KeyValue[]
  subEnvironments?: Environment[]
}

export type FolderConfiguration = Record<string, never>
