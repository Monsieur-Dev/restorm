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
 * Apply a streaming/listen node's quick-config (by id) onto the bound request,
 * returning the request to flush. A streaming connect/listen action picks a
 * saved config exactly like a request/send node; there are no per-input field
 * overrides on a scenario action (the request is edited in the normal editor),
 * so this is the same quick-config layer as `buildEffectiveRequest`.
 */
export function buildEffectiveStreamingRequest<T extends object>(req: T, overrideConfig: Record<string, unknown>): T {
  return buildEffectiveRequest(req, overrideConfig)
}
