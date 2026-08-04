/**
 * Centralised "effective request" resolver for request-type scenario actions.
 *
 * A request/send/connect/listen node bound to a saved request can pick a saved
 * quick-config (TASK-66.25) as its BASE. This module applies ONLY that config
 * layer — base request → quick-config fields (resolved by id from the file) —
 * applied ONCE here so every protocol executor (HTTP, gRPC unary, and the
 * streaming connect/listen path in `engine.ts`) inherits the identical
 * resolution instead of re-implementing it.
 *
 * A scenario action does NOT override individual request fields — the request
 * itself is edited only in the normal request editor; the action just PICKS a
 * saved config. Any WIRED-edge slot value (an upstream output wired into a
 * derived slot port) still layers on top in the HTTP executor's
 * `applySlotOverrides`, which runs AFTER this; handlebars resolves the final
 * merged request at serve time (HTTPExecutionService), after the slots.
 *
 * The quick-config is resolved by id from `request.quickConfigs[]` (the
 * .restorm-file / PROJECT store) — a scenario action can reference only a
 * project config (file-portable), never a user-settings config, so no snapshot
 * of its fields is stored on the node.
 */

import {
  applyActionFieldOverrides,
  readQuickConfigId,
  resolveProjectConfigFields
} from '../../../shared/scenarioActionOverride'
import { KeyValue } from '../../../shared/models/keyValues/KeyValue'
import { contextService } from '../../services/ContextService'

/** Identity / non-config fields a config must never clobber on the request
 * object — they define WHICH request this is, not how it's configured. */
const PROTECTED_FIELDS = new Set([
  'id',
  'name',
  'notes',
  'tags',
  'icon',
  'importOrigin',
  'deprecated',
  'removed',
  'type',
  'quickConfigs',
  'authenticationRequestId'
])

/**
 * Return the request to flush + execute for a bound node, with the node's picked
 * quick-config applied (base → config fields). When the node carries no
 * (resolvable) config, the original request is returned unchanged (no clone, no
 * cost). The per-input inline/wired overrides are layered on AFTER this by the
 * executor's slot-merge.
 *
 * The clone is prototype-preserving (so instance methods like `toPlainObject`
 * survive) and the overridden fields are deep-copied, so a mutation of the
 * returned request never touches the persisted one.
 */
export function buildEffectiveRequest<T extends object>(req: T, nodeConfig: Record<string, unknown>): T {
  const quickConfigId = readQuickConfigId(nodeConfig)
  // Resolve the picked config by id from the request's PROJECT (file-saved)
  // configs — the loaded .restorm file is the single source of truth; no
  // snapshot of the config's fields is stored on the node. A missing id (deleted
  // config) resolves to undefined → no config layer applied (the action keeps
  // its per-input overrides only; the UI shows a "config missing" surface).
  const resolvedConfigFields = quickConfigId !== undefined ? resolveProjectConfigFields(req, quickConfigId) : undefined
  if (resolvedConfigFields === undefined) return req

  // Read only the request's OWN enumerable, non-protected fields as the base,
  // then layer the resolved config fields on top of that map.
  const src = req as unknown as Record<string, unknown>
  const baseFields: Record<string, unknown> = {}
  for (const key of Object.keys(src)) {
    if (!PROTECTED_FIELDS.has(key) && typeof src[key] !== 'function') baseFields[key] = src[key]
  }
  const merged = applyActionFieldOverrides(baseFields, resolvedConfigFields, {})

  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(req) as object) as object,
    src
  ) as Record<string, unknown>
  for (const [key, value] of Object.entries(merged)) {
    if (PROTECTED_FIELDS.has(key)) continue
    clone[key] = value
  }
  // The config's field snapshot (and `applyActionFieldOverrides`' JSON clone)
  // carries KeyValue VALUES as PLAIN `{ type, value }` objects, not ValueType
  // instances — so the executor's `resolveKeyValueForRequest` would stringify
  // them to "[object Object]". Re-hydrate every KeyValue array back to instances
  // (KeyValue.fromPlain rebuilds the right ValueType, incl. ExpressionValue for
  // a `{{handlebars}}` value) so resolution works exactly like the un-configured
  // request.
  for (const field of ['headers', 'params', 'pathParams', 'metadata']) {
    const arr = clone[field]
    if (Array.isArray(arr)) {
      clone[field] = arr.map((kv) =>
        kv instanceof KeyValue ? kv : KeyValue.fromPlain(kv as Parameters<typeof KeyValue.fromPlain>[0]))
    }
  }
  return clone as unknown as T
}

/**
 * Overlay the row state the user is CURRENTLY looking at onto a request read
 * from the CollectionStore.
 *
 * The store holds what was loaded or last saved; the request panel's live
 * edits reach ContextService immediately (every row change calls
 * `context:update-request-key-values`) but do not touch the store until a
 * save. A scenario run reads the store, so without this overlay it executes
 * the PRE-EDIT rows: a row the user just unchecked is still sent, and one
 * they just checked is still missing — the panel and the run disagreeing
 * about the same request.
 *
 * Only `enabled` is overlaid, and deliberately so. ContextService receives
 * each row's value already stringified (`value.toString()` at the IPC
 * boundary), so copying values back would flatten a `customList` or enum row
 * into the plain text of whatever it happened to resolve to — destroying the
 * binding to reproduce a checkbox. `enabled` is a boolean: it survives that
 * trip intact, and it is the whole of the reported defect. A value edit still
 * reaches the run through the normal save.
 *
 * Rows are matched by id; a row ContextService doesn't know (added since, or
 * a group it never received) keeps the store's state.
 */
export function overlayLiveKeyValues<T extends object>(req: T, requestId: string): T {
  const live = contextService.getRequestContext(requestId)
  if (!live) return req

  const src = req as unknown as Record<string, unknown>
  let clone: Record<string, unknown> | undefined

  for (const field of ['headers', 'params', 'pathParams', 'metadata']) {
    const rows = src[field]
    const liveRows = live.keyValueGroups.get(field)
    if (!Array.isArray(rows) || !liveRows) continue

    const enabledById = new Map<string, boolean>()
    for (const row of liveRows) {
      if (row.id !== undefined) enabledById.set(row.id, row.enabled !== false)
    }

    const next = rows.map((kv: unknown) => {
      const row = kv as { id?: string; enabled?: boolean }
      if (row.id === undefined) return kv
      const liveEnabled = enabledById.get(row.id)
      if (liveEnabled === undefined || liveEnabled === (row.enabled !== false)) return kv
      // Prototype-preserving copy: the executor calls instance methods on
      // these rows (`toPlainObject`, the ValueType's `toString`), so a plain
      // spread would strip them.
      const copy = Object.assign(Object.create(Object.getPrototypeOf(kv as object) as object) as object, kv) as {
        enabled: boolean
      }
      copy.enabled = liveEnabled
      return copy
    })
    // Identity comparison, not a mutated flag: every untouched row is returned
    // as the SAME object above, so a differing reference is exactly "this row
    // was overlaid".
    if (next.every((kv, i) => kv === rows[i])) continue

    // Clone lazily — an untouched request must stay the very object the store
    // holds, so nothing downstream can mutate a copy and lose the write.
    clone ??= Object.assign(Object.create(Object.getPrototypeOf(req) as object) as object, src) as Record<
      string,
      unknown
    >
    clone[field] = next
  }

  return (clone ?? src) as unknown as T
}

/**
 * Apply a streaming/listen node's quick-config (by id) onto the bound request,
 * returning the request to flush. A streaming connect/listen action picks a
 * saved config exactly like a request/send node; there are no per-input field
 * overrides on a scenario action (the request is edited in the normal editor),
 * so this is the same quick-config layer as `buildEffectiveRequest`.
 */
export function buildEffectiveStreamingRequest<T extends object>(req: T, overrideConfig: Record<string, unknown>): T {
  return buildEffectiveRequest(req, overrideConfig)
}
