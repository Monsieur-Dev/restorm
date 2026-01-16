import type { RuntimeId, Icon } from '../baseTypes'

export interface BaseRequest {
  id: RuntimeId
  name: string
  icon?: Icon
  documentation: string
  notes?: string
  tags: string[]
}
