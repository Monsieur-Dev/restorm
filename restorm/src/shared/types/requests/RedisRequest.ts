import type { BaseRequest } from './BaseRequest'
import type { RedisMode, RedisCommandName } from '../requestPrimitives'

export interface RedisRequest extends BaseRequest {
  type: 'redis'
  /** Connection URL (`redis://` / `rediss://` / `redis-cluster://`). */
  url: string
  /** Auth password (handlebars-resolved; may resolve from an env/secret). No
   * username — most Redis deployments gate on password alone. */
  password?: string | undefined
  /** Which execution path this request runs — the source of truth for
   * dispatch. Subscribe and command never run on the same request. */
  mode: RedisMode

  // Subscribe mode (mode === 'subscribe').
  /** Channels to subscribe to. */
  channels: string[]

  // Command mode (mode === 'command').
  /** One of the palette commands; ignored when `freeformCommand` is set. */
  command?: RedisCommandName | undefined
  /** Positional args for `command` (handlebars-resolved). */
  args: string[]
  /** Freeform command line override (e.g. `"SET foo bar"`) — takes
   * precedence over `command`/`args` when non-empty, for anything the
   * palette doesn't cover. */
  freeformCommand?: string | undefined
}
