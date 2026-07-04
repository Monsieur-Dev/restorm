/**
 * Command-aware field layout for the Redis command-mode editor. Describes how
 * the positional `RedisRequest.args` array maps onto structured, labeled UI
 * fields per command (e.g. `SET` -> key + value) instead of one
 * space-separated text blob. Kept dependency-free like `redisCommand.ts` so
 * both the renderer view and its unit tests can import it without pulling in
 * React.
 */

import type { RedisCommandName } from '../models/types'

/** One fixed-position argument field, always present at this `args` slot for
 * the owning command. */
export interface RedisArgField {
  /** Stable id, used for the field's data-testid suffix. */
  key: string
  /** i18n key for the field's label. */
  labelKey: string
}

/** Field layout for one Redis command: a fixed, ordered prefix covering the
 * command's mandatory args, optionally followed by a repeatable tail for
 * commands with variable arity (e.g. `DEL`'s extra keys, `LPUSH`'s extra
 * values). Commands with a genuinely irregular grammar (`XREAD`'s
 * `COUNT`/`BLOCK`/`STREAMS` flags) intentionally have no entry and fall back
 * to {@link GENERIC_FALLBACK} via {@link getRedisCommandFields}. */
export interface RedisCommandFieldsSpec {
  fixed: RedisArgField[]
  repeatable?: { labelKey: string }
}

const KEY: RedisArgField = { key: 'key', labelKey: 'redis.fields.key' }
const FIELD: RedisArgField = { key: 'field', labelKey: 'redis.fields.field' }
const VALUE: RedisArgField = { key: 'value', labelKey: 'redis.fields.value' }

/** Command-aware layouts for the app's fixed command palette (`REDIS_COMMANDS`
 * in `../models/types`). */
export const REDIS_COMMAND_FIELDS: Partial<Record<RedisCommandName, RedisCommandFieldsSpec>> = {
  GET: { fixed: [KEY] },
  SET: { fixed: [KEY, VALUE] },
  HGET: { fixed: [KEY, FIELD] },
  HSET: { fixed: [KEY, FIELD, VALUE] },
  LRANGE: { fixed: [KEY, { key: 'start', labelKey: 'redis.fields.start' }, { key: 'stop', labelKey: 'redis.fields.stop' }] },
  PUBLISH: { fixed: [{ key: 'channel', labelKey: 'redis.fields.channel' }, { key: 'message', labelKey: 'redis.fields.message' }] },
  DEL: { fixed: [], repeatable: { labelKey: 'redis.fields.key' } },
  LPUSH: { fixed: [KEY], repeatable: { labelKey: 'redis.fields.value' } },
  RPUSH: { fixed: [KEY], repeatable: { labelKey: 'redis.fields.value' } },
  XADD: { fixed: [KEY, { key: 'id', labelKey: 'redis.fields.id' }], repeatable: { labelKey: 'redis.fields.fieldOrValue' } }
}

/** Generic fallback for `XREAD` and any command outside the table above (or
 * no command selected yet): one plain field per positional argument, still
 * fixing the space-in-value bug even without command-aware labels. */
const GENERIC_FALLBACK: RedisCommandFieldsSpec = { fixed: [], repeatable: { labelKey: 'redis.fields.argument' } }

/** Resolve the field layout for a command name (case-sensitive, matches the
 * palette's uppercase convention). Unknown/undefined commands get the generic
 * fallback rather than throwing, since the command may be user-typed via a
 * quick config or not yet selected. */
export function getRedisCommandFields(command: string | undefined): RedisCommandFieldsSpec {
  if (!command) return GENERIC_FALLBACK
  return REDIS_COMMAND_FIELDS[command as RedisCommandName] ?? GENERIC_FALLBACK
}
