/**
 * Re-identification of a project subtree: give every id-bearing node a fresh
 * id, then remap every known id REFERENCE onto the new ids, so the subtree is
 * self-consistent and independent of wherever it came from.
 *
 * Two consumers share this primitive, which is exactly why it lives in
 * `shared/` rather than in the renderer's tree utilities where it was born:
 * - the renderer's **Clone** action (`deepCloneItem`), and
 * - the **project import** path (renderer `useImport` for every format, and
 *   the main-process `.restorm` importer whose output may be inserted as-is
 *   by the MCP import tool without the renderer's regeneration pass).
 *
 * Running the pair twice over the same forest is safe by construction: each
 * full pass produces a consistent old→new mapping and rewrites the reference
 * surface with it, so a second pass simply moves consistent ids to other
 * consistent ids. What is NOT safe is pairing this reassignment with a
 * PARTIAL reference remap (or vice versa) — every reference key that is not
 * rewritten keeps pointing at an id that no longer exists, or worse, at the
 * ORIGINAL element when it is still in the same tree.
 */

/** Generate a unique ID. Uses crypto.randomUUID (collision-free) rather
 * than Date.now()+Math.random(), which collides for two ids minted in the
 * same millisecond — fatal here since these ids key the per-request
 * stores. Matches serialization.ts's generateId(). Available in both the
 * renderer and the main process (Node ≥ 19). */
export function generateUniqueId(): string {
  return crypto.randomUUID()
}

/** Every container key `reassignTreeIds` descends into. A flat list applied to
 * EVERY visited node — a key absent on a given node (e.g. a request has no
 * `environments`) is a no-op, so one list safely covers every `FolderItem`
 * kind (folder / environment folder / environment / enum definition /
 * custom value list / request / scenario / scenario node / scenario edge),
 * plus `quickConfigs` (a field every request model declares outside that
 * union — see below).
 *
 * Kept as its own named export so a coverage test can enumerate every
 * id-bearing container type known to the `FolderItem` type system and assert
 * each one's key is actually in this list — the failure mode this guards is
 * exactly how this list has gone stale before: container keys were added to
 * the persisted types over time without a matching entry here, and nothing
 * caught it.
 *
 * `params` covers TWO shapes on purpose: `Scenario.params` (top-level param
 * declarations) and a request's own query `KeyValue[]`. The two collide on
 * the key name, which is why `params` was once handled by a dedicated
 * scenario-only branch — reassigning request KeyValue rows was then "a
 * materially bigger and unrelated change". Both are wanted now: a cloned
 * request used to keep its rows' ids byte-identical to the source
 * (transient — `generateIds`' duplicate-id dedup healed it at the next
 * load, but until then the in-memory clone shared row identity with its
 * source). One generic entry treats both shapes; a SECOND pass over
 * `Scenario.params` (the old branch on top of the list entry) would be
 * worse than redundant — the second reassignment orphans the idMap's
 * first mapping, so references and import side-data resolve to an id the
 * tree no longer carries.
 *
 * **What this list's completeness claim actually covers, stated precisely
 * after getting it wrong once:** it is exhaustive over `FolderItem`'s own
 * container surface (`collections.ts`) — every array of id-bearing objects
 * reachable through a folder/scenario/environment/custom-value-list, with
 * `ScenarioPort.id` and a node's `config` bag (except `config.params`, see
 * {@link reassignTreeIds}) as the two deliberate, reasoned exclusions WITHIN
 * that surface. It is **not** exhaustive over every id-bearing array the
 * PERSISTED FORMAT contains: each per-protocol request model
 * (`src/shared/types/requests/*.ts`) can declare its own arrays outside the
 * `FolderItem` union, and the coverage test — fixture-bounded, built to
 * enumerate `FolderItem`'s containers — cannot see those by construction.
 * `quickConfigs` is one such array; it was added here only after an e2e run
 * demonstrated the duplicate-id consequence directly, not because the
 * coverage test caught it. `headers` / `params` / `pathParams` (a request's
 * `KeyValue[]` rows, every protocol) are the same out-of-union shape and are
 * reassigned as a trio — a clone that refreshed its query params but kept
 * its header ids would be a half-fix harder to reason about than none.
 * Confirmed out-of-union arrays this list still deliberately does NOT
 * reach: `StompRequest.subscriptions[].id` — looked up scoped to
 * `(requestId, subscriptionId)`, never globally, the same "scoped pair, not
 * a bare id" pattern that already justifies leaving scenario node ids
 * resolvable only via `(scenarioId, nodeId)`; `ODataRequest.batchSubRequests
 * [].id` — its own type doc calls it "Stable ID used by the UI for keys /
 * reordering", the same STRUCTURAL-LABEL class as `ScenarioPort.id`, not
 * instance identity. Neither is a demonstrated live bug the way
 * `quickConfigs` was. But "probably benign" is not the same claim as
 * "exhaustively enumerated" — there may be others of this shape not yet
 * found, and nothing but a targeted probe (or another e2e run) will surface
 * the next one. */
export const REASSIGNED_ID_CONTAINER_KEYS = [
  'items', 'environments', 'customValueLists',
  'enumDefinitions', 'subEnvironments', 'entries',
  'nodes', 'edges', 'quickConfigs',
  'headers', 'params', 'pathParams'
] as const

/** Give a fresh id to this object and to every descendant that carries one and
 * could collide in the tree: child `items` (folders / scenarios / requests),
 * an environment folder's `environments`, `customValueLists` and
 * `enumDefinitions`, an environment's `subEnvironments` (recursively — each
 * nested `Environment` re-enters this same function, so N levels of nesting
 * need no dedicated code), a custom value list's `entries`, a scenario's
 * `nodes` + `edges` + top-level `params`, and a request's project-target
 * `quickConfigs` (an ad-hoc `QuickConfig[]` field every request model
 * declares — not part of the formal `FolderItem` union, but present in the
 * persisted JSON `deepCloneItem`'s round-trip carries verbatim, so it needs
 * the same treatment as everything else here). Records every old→new
 * mapping so references can be remapped afterwards (see `remapReferences` /
 * {@link ID_REFERENCE_KEYS} — `nodeId`, `connectionNodeId`, and `requestId`
 * are what make a cloned scenario's edges, cross-node config, and a cloned
 * request's own `quickConfigs[].requestId` follow the copy instead of
 * dangling on the original — `requestId` was already a reference key for
 * scenario-node → request bindings, and a `QuickConfig`'s own `requestId`
 * field happens to be the identical key name, so the existing generic walk
 * remaps it for free).
 *
 * Two things a scenario carries are deliberately EXCLUDED, for opposite
 * reasons than everything above:
 * - **`ScenarioPort.id`** (`inputs`/`outputs` on a node) is not instance
 *   identity, it is a structural label: fixed-arity node kinds copy a
 *   literal constant (`'value'`, `'then'`, `'else'`, …) from the kind's
 *   static template (`scenarioKindRegistry.ts`) onto every node of that kind,
 *   and dynamic-arity ports are content-derived (`pathParams:<key>`), never
 *   randomly generated. The rest of the codebase matches ports by that exact
 *   string in dozens of places (`edges.some(e => e.to.portId === 'value')`).
 *   Reassigning a port id would be a REGRESSION, not a stricter fix: the
 *   clone's own edges would stop matching its own nodes' ports.
 * - **A scenario node's `config` bag** is opaque per-kind data, not a
 *   document — `generateIds` already treats it this way (it strips any id a
 *   config carries, see `serialization.ts`). `config.params`
 *   (`InputParam[]`, an `input` node's own declared parameters) is the one
 *   exception worth taking: it costs one targeted, narrow lookup (not a
 *   generic walk into `config`), and reassigning it is free — nothing
 *   resolves an `InputParam` by id, only by name (`scenarioInputParams.ts`).
 *   `config.connectionNodeId` (a REFERENCE into another node, not a
 *   container) is handled separately, via {@link ID_REFERENCE_KEYS}. */
export function reassignTreeIds(node: unknown, idMap: Map<string, string>): void {
  if (node === null || typeof node !== 'object') return
  const rec = node as Record<string, unknown>
  const id = rec['id']
  if (typeof id === 'string' && id !== '') {
    const next = generateUniqueId()
    idMap.set(id, next)
    rec['id'] = next
  }
  for (const key of REASSIGNED_ID_CONTAINER_KEYS) {
    const arr = rec[key]
    if (Array.isArray(arr)) for (const child of arr) reassignTreeIds(child, idMap)
  }
  // An `input` scenario node's own config.params (InputParam[]) — narrow,
  // targeted lookup (not a generic descent into `config`); see the JSDoc
  // above for why this one's worth the exception and ports/the rest of
  // `config` are not.
  if ('kind' in rec && typeof rec['config'] === 'object' && rec['config'] !== null) {
    const cfgParams = (rec['config'] as Record<string, unknown>)['params']
    if (Array.isArray(cfgParams)) for (const param of cfgParams) reassignTreeIds(param, idMap)
  }
}

/**
 * The set of object keys that hold a REFERENCE to another tree item's id (and
 * so must follow a clone's remapped ids). Scoping the rewrite to these keys
 * means a free-text field that coincidentally equals an id (a URL, a note, a
 * header value) is never silently mutated — the old code rewrote ANY string
 * matching a remapped id, in any field.
 *
 * `nodeId` (an edge's `from.nodeId`/`to.nodeId`) was a no-op until now —
 * `reassignTreeIds` never reassigned a node id, so this entry never had
 * anything to remap. It goes live the moment nodes are reassigned, which is
 * exactly the point of keeping it here rather than adding it fresh: the
 * remap plumbing was already correct, only the reassignment side was
 * missing. `connectionNodeId` is the equivalent for 23 scenario node kinds'
 * connect/close pairs (`config.connectionNodeId`, e.g. a `socketioClose`
 * node referencing its `socketioConnect` node) — a live, runtime-read
 * cross-node reference (`main/scenarioEngine/executors/*.ts`) that was
 * simply never at risk before either, for the same reason.
 *
 * `requestId` predates all of this (a scenario node's `config.requestId`
 * binding a request), but it does double duty now: a `QuickConfig`'s own
 * `requestId` field (identifying which request owns it, see
 * `main/mcp/quickConfig.ts`) shares the exact key name, so a cloned
 * request's own `quickConfigs[].requestId` gets remapped onto the CLONE by
 * the same generic walk — self-referential (the config lives ON the
 * request it names), and correct precisely because the walk doesn't care
 * where a key appears structurally, only what it's called.
 *
 * The list is exactly the reference fields the persisted document actually
 * carries, audited field by field against the type system and the node-kind
 * configs — see the table in `treeManipulation.test.ts`, which asserts each
 * one individually AND that nothing else is in here. Speculative entries
 * are worse than useless: a key that names no persisted field cannot help,
 * and if the name is later claimed by a FREE-TEXT field it starts silently
 * rewriting user content. `portId` is the one live key deliberately left
 * out — a port id is a structural label copied from the node kind's static
 * template, never reassigned, so following it would break a clone's edges
 * against its own nodes.
 *
 * The failure mode this guards is quiet by construction: a missing key is a
 * no-op until the ids it names start moving. `connectionNodeId` sat absent
 * and harmless for as long as scenario node ids were never reassigned, and
 * broke every cloned connect/close pair the moment they were. Adding a
 * container to {@link REASSIGNED_ID_CONTAINER_KEYS} means auditing this
 * list in the same breath.
 */
export const ID_REFERENCE_KEYS = new Set<string>([
  'listId',
  'scenarioId',
  'requestId',
  'nodeId',
  'connectionNodeId',
  // A scenario action's picked quick-config (`QUICK_CONFIG_ID_KEY`,
  // `shared/scenarioActionOverride.ts`). Resolved SCOPED to the request that
  // owns the config, so a clone still naming the original's id resolves to
  // nothing on its own request and silently degrades to "config missing".
  'quickConfigId',
  // A request's auth route, and an env folder's spec-refresh config
  // (`ApiUpdateConfig`) — the same key name on two different carriers, both
  // pointing at an `auth` request, both covered by this one entry.
  'authenticationRequestId',
  // An enum-typed variable's definition (`EnumValue` / `EnumListValue`).
  // EnumDefinitions are resolved by a global id sweep over the whole tree,
  // so an unfollowed reference does not dangle — it silently binds the copy
  // to the ORIGINAL folder's definition.
  'enumDefinitionId'
])

/** After ids are reassigned, walk the subtree and replace an old id with
 * its new id ONLY in known reference fields (see {@link ID_REFERENCE_KEYS}) — so
 * references to the reassigned items/environments/lists follow the copy without
 * touching free-text fields that happen to contain a matching string. The `id`
 * fields themselves already hold new ids and are skipped. */
export function remapReferences(node: unknown, idMap: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const v of node) remapReferences(v, idMap)
    return
  }
  if (node === null || typeof node !== 'object') return
  const rec = node as Record<string, unknown>
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'id') continue
    if (typeof value === 'string') {
      if (!ID_REFERENCE_KEYS.has(key)) continue
      const mapped = idMap.get(value)
      if (mapped !== undefined) rec[key] = mapped
    } else {
      remapReferences(value, idMap)
    }
  }
}

/**
 * Re-identify a FOREST in place: fresh ids for every id-bearing node across
 * ALL the given roots first, then one reference-remap pass over the whole
 * forest with the accumulated map — so a reference from one root into a
 * SIBLING root (a scenario at the top level binding a request in another
 * imported collection) follows the copies too, which a per-root
 * reassign+remap would miss.
 *
 * Mutates the given nodes. Returns the accumulated old→new id map (the
 * import flow forwards it to `postImportSeed` so format-specific side data
 * keyed by parse-time ids can find the final ones).
 */
export function reidentifyForest(roots: readonly unknown[], idMap: Map<string, string> = new Map<string, string>()): Map<string, string> {
  for (const root of roots) reassignTreeIds(root, idMap)
  for (const root of roots) remapReferences(root, idMap)
  return idMap
}
