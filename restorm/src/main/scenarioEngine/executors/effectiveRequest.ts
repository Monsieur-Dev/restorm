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
 * The per-input OVERRIDES (inline literal in `config.overrides[portId]`) and the
 * WIRED-edge slot values are NOT applied here — they layer on top in the HTTP
 * executor's `applySlotOverrides`, which runs AFTER this. Full order:
 *   base request → quick-config (by id) → inline override → wired edge (live) → handlebars LAST
 * so a wired value wins over an inline literal, and handlebars resolves the
 * final merged request at serve time (HTTPExecutionService), after all slots.
 *
 * The quick-config is resolved by id from `request.quickConfigs[]` (the
 * .restorm-file / PROJECT store) — a scenario action can reference only a
 * project config (file-portable), never a user-settings config, so no snapshot
 * of its fields is stored on the node.
 */

import {
  applyActionFieldOverrides,
  readActionOverrides,
  readQuickConfigId,
  resolveProjectConfigFields
} from '../../../shared/scenarioActionOverride'
import { coercePersistedOverride } from './overrideValue'

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
  return clone as unknown as T
}

/**
 * Apply a streaming/listen node's quick-config (by id) AND its inline per-input
 * overrides onto the bound request, returning the request to flush. Used by the
 * engine's connect/listen bridge, where there is no HTTP-style per-key slot
 * merge: a connect/listen node's override ports are whole fields (url, topic,
 * namespace, server config, …), so an override keyed by a direct field name
 * replaces that field. Slot-style keys (`headers:<key>` etc.) are ignored here —
 * streaming nodes don't expose per-key KV ports.
 *
 * Order: base → quick-config (by id) → inline field override. (No wired-edge
 * layer on the connect handoff — a streaming connection opens once with the
 * resolved request; live data flows on the SEND nodes, not the connect.)
 */
export function buildEffectiveStreamingRequest<T extends object>(req: T, overrideConfig: Record<string, unknown>): T {
  const withConfig = buildEffectiveRequest(req, overrideConfig)
  const overrides = readActionOverrides(overrideConfig)
  const fieldKeys = Object.keys(overrides).filter((k) => !k.includes(':') && !PROTECTED_FIELDS.has(k) && overrides[k] !== undefined)
  if (fieldKeys.length === 0) return withConfig

  const src = withConfig as unknown as Record<string, unknown>
  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(withConfig) as object) as object,
    src
  ) as Record<string, unknown>
  // An inline typed-value literal (`{ type:'string', value }`, …) resolves to
  // its wire form (a string for url/topic; `{{handlebars}}` for a variable); a
  // wired value or an OBJECT field (server config) passes through unchanged.
  for (const key of fieldKeys) clone[key] = cloneValue(coercePersistedOverride(overrides[key]))
  return clone as unknown as T
}

function cloneValue(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v)) as unknown
  } catch {
    return v
  }
}
