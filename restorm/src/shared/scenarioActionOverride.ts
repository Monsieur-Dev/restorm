/**
 * A request-type scenario action (a node bound to a saved request via
 * `config.requestId`) can override the bound request's configuration in two
 * layered ways, both persisted in the node's free `config` bag:
 *
 *  - `config.quickConfigId` — the id of a saved quick-config (the
 *    request-quick-settings feature) the action picked as its BASE. Binding is
 *    by ID, never by name, so renaming the config does not break the action and
 *    deleting it leaves the action with its per-field overrides only (plus a
 *    "config missing" surface, not a silent failure). A scenario action may pick
 *    ONLY a PROJECT-target config (one stored in the `.restorm` file, on
 *    `request.quickConfigs[]`) — never a user-settings config: a scenario lives
 *    in the file and must stay portable, so it cannot reference a user-local
 *    config that lives in another user's settings, not in the file. Because
 *    project configs round-trip into the main process via the request, the
 *    executor resolves the config by id directly from `request.quickConfigs` —
 *    no snapshot of its fields is stored on the node.
 *
 *  - `config.overrides` — per-field static overrides the action layers ON TOP
 *    of the (optional) quick-config. A field present here wins over the saved
 *    config; an absent field inherits from the config (or, with no config, from
 *    the bound request). This is the explicit per-input override the popover
 *    edits, distinct from a WIRED-edge slot value (which still wins last — live
 *    data beats stored, see the executor's resolution order).
 *
 * Runtime resolution order (most specific last):
 *   base request → quick-config (by id) → config.overrides → wired-edge slot value
 *
 * These readers live in `shared` so the renderer popover and the main-process
 * executor agree on the exact config shape.
 */

/** Field key of the picked quick-config's stable id (rename-safe binding). */
export const QUICK_CONFIG_ID_KEY = 'quickConfigId'
/** Field key of the per-field static overrides the action layers on top. */
export const OVERRIDES_KEY = 'overrides'

/** Read the picked quick-config id from a node config, or undefined. */
export function readQuickConfigId(config: Record<string, unknown>): string | undefined {
  const v = config[QUICK_CONFIG_ID_KEY]
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** Read the per-field static overrides from a node config (always an object). */
export function readActionOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const v = config[OVERRIDES_KEY]
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * Resolve a PROJECT-target quick-config's field snapshot for a request, by id.
 * Reads `request.quickConfigs[]` (the .restorm-file store, reachable in both the
 * renderer and the main process). Returns the config's `fields` map, or
 * undefined when the request has no such config (a deleted / never-existing id →
 * the "config missing" state; the action keeps its static overrides only).
 */
export function resolveProjectConfigFields(request: unknown, quickConfigId: string): Record<string, unknown> | undefined {
  const raw = (request as { quickConfigs?: unknown } | null | undefined)?.quickConfigs
  if (!Array.isArray(raw)) return undefined
  for (const c of raw) {
    if (c !== null && typeof c === 'object'
      && (c as { id?: unknown }).id === quickConfigId
      && (c as { storageTarget?: unknown }).storageTarget !== 'settings') {
      const fields = (c as { fields?: unknown }).fields
      return fields !== null && typeof fields === 'object' && !Array.isArray(fields)
        ? (fields as Record<string, unknown>)
        : {}
    }
  }
  return undefined
}

/**
 * Layer the action's resolved quick-config fields then its per-field static
 * overrides onto a plain field map (the bound request's own fields), returning a
 * NEW map. Deep-clones via JSON so a downstream mutation never touches the
 * source. The wired-edge layer is applied separately by the executor (it wins
 * last).
 *
 * A field whose override value is `undefined` is treated as "inherit" and
 * skipped, so the popover's tri-state clear (revert a field to inherit) drops
 * the key from `config.overrides` rather than forcing a value.
 */
export function applyActionFieldOverrides(
  baseFields: Record<string, unknown>,
  resolvedConfigFields: Record<string, unknown> | undefined,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = clone(baseFields)
  if (resolvedConfigFields) {
    for (const [k, v] of Object.entries(resolvedConfigFields)) {
      if (v !== undefined) merged[k] = clone(v)
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) merged[k] = clone(v)
  }
  return merged
}

function clone<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v)) as T
  } catch {
    return v
  }
}
