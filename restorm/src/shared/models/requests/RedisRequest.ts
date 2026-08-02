/**
 * RedisRequest - Redis pub/sub + common-command request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { pickImportMarkers, type ImportMarkerFields } from './importMarkers'
import type { RequestType, RuntimeId, Icon, RedisMode, RedisCommandName } from '../types'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/**
 * Redis request definition. `mode` is the source of truth for dispatch:
 * subscribe (streaming, multi-channel) and command (unary, REPL-like) never
 * run on the same request.
 */
@fileNaming({ pattern: '{index} - REDIS - {name}', nameProperty: 'name', idProperty: 'id' })
export class RedisRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'redis'

  /** Connection URL (`redis://` / `rediss://` / `redis-cluster://`) */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Auth password (handlebars-resolved; may resolve from an env/secret) */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  password?: string

  /** Which execution path this request runs */
  @graphqlField({ type: 'RedisMode' })
  @searchable.property({ filterable: true })
  mode: RedisMode = 'command'

  // ----------------------------------------------------------------------
  // Subscribe mode (mode === 'subscribe')
  // ----------------------------------------------------------------------

  /** Channels to subscribe to */
  @graphqlField({ type: 'String', isArray: true })
  channels: string[] = []

  // ----------------------------------------------------------------------
  // Command mode (mode === 'command')
  // ----------------------------------------------------------------------

  /** One of the palette commands; ignored when `freeformCommand` is set */
  @graphqlField({ type: 'RedisCommandName', nullable: true })
  @TreatEmptyAsUndefined()
  command?: RedisCommandName

  /** Positional args for `command` (handlebars-resolved) */
  @graphqlField({ type: 'String', isArray: true })
  args: string[] = []

  /** Freeform command line override — takes precedence over `command`/`args`
   * when non-empty, for anything the palette doesn't cover */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  freeformCommand?: string

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<RedisRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
    }
  }

  /**
   * Create a RedisRequest from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    authenticationRequestId?: RuntimeId
    url?: string
    password?: string
    mode?: RedisMode
    channels?: string[]
    command?: RedisCommandName
    args?: string[]
    freeformCommand?: string
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): RedisRequest {
    return new RedisRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      ...pickImportMarkers(obj),
      url: obj.url ?? '',
      ...(obj.password !== undefined && { password: obj.password }),
      mode: obj.mode ?? 'command',
      channels: obj.channels ?? [],
      ...(obj.command !== undefined && { command: obj.command }),
      args: obj.args ?? [],
      ...(obj.freeformCommand !== undefined && { freeformCommand: obj.freeformCommand }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this RedisRequest
   */
  toPlainObject(): Record<string, unknown> {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      ...(this.authenticationRequestId !== undefined && { authenticationRequestId: this.authenticationRequestId }),
      ...pickImportMarkers(this),
      url: this.url,
      ...(this.password !== undefined && { password: this.password }),
      mode: this.mode,
      channels: this.channels,
      ...(this.command !== undefined && { command: this.command }),
      args: this.args,
      ...(this.freeformCommand !== undefined && { freeformCommand: this.freeformCommand }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
