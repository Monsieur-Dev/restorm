import type { Folder, FolderItem } from '../../../shared/types/folderTypes'
import { isAnyFolder, isRequest } from '../../../shared/types/folderTypes'
import type { AuthenticationRequest, HTTPRequest, Request } from '../../../shared/types/requests'
import type { QuickConfig } from '../../../shared/types/requests/QuickConfig'
import type { GitEntityKind } from '../../../shared/git/gitCommitDiff'
import { stripIds } from '../utils/serialization'

/**
 * Per-entity field-level diff for the conflict-resolution 4-panel view —
 * the restorm half of AC#4/#9 ("restorm injects ... field-diff
 * computation"). `fields` maps a field name to whether it differs between
 * `ours` and `theirs` (consumed by the host to spread `fieldDiffStyle`
 * onto the matching input); `preselectTabId`, when set, is the tab that
 * should be highlighted/preselected on every panel (AC#5) because it's
 * where the differing field lives.
 *
 * Returns `undefined` only for scenarios — Yoann's explicit decision
 * (shown as a whole graph, no highlighting — see `docs/Git/README.md`'s
 * "Conflict resolution" section) — and the pathological case of a
 * conflict whose two sides somehow have different `request.type`s (no
 * sensible diff to compute). Every request protocol gets a diff: HTTP/auth
 * via the bespoke `computeRequestFieldDiff`, the rest via the coarser
 * `computeGenericRequestFieldDiff`.
 */
export interface EntityFieldDiff {
  fields: Record<string, boolean>
  preselectTabId?: string
  /** Names of the saved project quick-configs that exist on BOTH sides under
   * the same name but differ in content — the ones the conflict modal
   * red-flags and offers an individual ours/theirs pick for. Empty/omitted
   * when no quick-config conflicts (the common case). Only meaningful for
   * request entities. */
  conflictingQuickConfigNames?: string[]
}

/**
 * A Folder/EnvironmentFolder's own fields include `name` / `tags` /
 * `configuration`, but the normal panel (`BaseFolderView`) only ever
 * surfaces `notes` as an editable input — the rest are edited elsewhere
 * (sidebar rename, a separate settings modal). Only `notes` is worth
 * diffing here; a `name`/`tags`/`configuration`-only conflict still shows
 * up in the conflict list (via `identifyConflictingEntities`) but has no
 * tab to preselect in this panel.
 */
function computeFolderFieldDiff(ours: Folder, theirs: Folder): EntityFieldDiff {
  const notes = (ours.notes ?? '') !== (theirs.notes ?? '')
  return { fields: { notes }, ...(notes ? { preselectTabId: 'notes' } : {}) }
}

/**
 * Value-level compare that ignores the same runtime-only key-value row ids
 * `ownFieldsSnapshot` normalizes away — reused here so a `headers`/`params`
 * comparison doesn't false-positive on id churn from two independent YAML
 * parses (see that function's comment for the full story).
 */
function snapshotDiffers(a: unknown, b: unknown): boolean {
  return JSON.stringify(stripIds(a)) !== JSON.stringify(stripIds(b))
}

function isHTTPShaped(request: Request): request is HTTPRequest | AuthenticationRequest {
  return request.type === 'http' || request.type === 'auth'
}

function isAuthRequest(request: Request): request is AuthenticationRequest {
  return request.type === 'auth'
}

/** Read the ad-hoc `quickConfigs` field off any request-shaped item — it's not
 * part of the typed `Request`/`FolderItem` union (see `requestQuickConfigStore.
 * ts`). Exported so the conflict modal + write-back read it the same way this
 * module's diff does. */
export function readQuickConfigs(item: unknown): QuickConfig[] {
  const configs = (item as { quickConfigs?: QuickConfig[] } | null)?.quickConfigs
  return Array.isArray(configs) ? configs : []
}

function projectQuickConfigsOf(request: Request): QuickConfig[] {
  return readQuickConfigs(request)
}

/**
 * Whole-config pick-ours/theirs granularity (Yoann's locked decision): a
 * quick config that exists on only one side merges in automatically (not a
 * conflict — `buildMergedProjectTree` folds it in at write-back); only a
 * config with the SAME name and DIFFERENT `fields` on both sides is a real
 * conflict. No per-field diff inside a config — it's whole-config or
 * nothing.
 */
function quickConfigsConflict(ours: QuickConfig[], theirs: QuickConfig[]): boolean {
  const theirsByName = new Map(theirs.map((c) => [c.name, c]))
  return ours.some((oursConfig) => {
    const theirsConfig = theirsByName.get(oursConfig.name)
    return theirsConfig !== undefined && snapshotDiffers(oursConfig.fields, theirsConfig.fields)
  })
}

/** The NAMES of the quick-configs that genuinely conflict (same name on both
 * sides, different content) — the per-config granularity the conflict modal's
 * picker needs, where `quickConfigsConflict` only answers yes/no. */
function conflictingQuickConfigNames(ours: QuickConfig[], theirs: QuickConfig[]): string[] {
  const theirsByName = new Map(theirs.map((c) => [c.name, c]))
  return ours
    .filter((oursConfig) => {
      const theirsConfig = theirsByName.get(oursConfig.name)
      return theirsConfig !== undefined && snapshotDiffers(oursConfig.fields, theirsConfig.fields)
    })
    .map((oursConfig) => oursConfig.name)
}

/**
 * Field-level diff for an HTTP/auth request's normal panel
 * (`HTTPRequestTabView`) — the one protocol with a bespoke, more granular
 * breakdown than `computeGenericRequestFieldDiff` below. Discrete inputs
 * (`url`, `method`, `notes`, and the auth-only `expirationExpression`) get
 * their own boolean so the host can red-border that exact field; list-
 * shaped sections (`headers`/`params`/`pathParams`/`body`/
 * `producedHeaders`/`authErrorCodes`) are diffed as a single whole-section
 * boolean — coarse by design (AC#4 only asks for per-input granularity on
 * discrete fields, not per-row).
 *
 * `preselectTabId` favors the main "Request" tab (url/method/headers/
 * params/pathParams/body) over the auth-only "Configuration" tab, over
 * "Notes" — the same priority a human skimming the conflict would use: the
 * transport config is usually the interesting part.
 */
function computeRequestFieldDiff(ours: HTTPRequest | AuthenticationRequest, theirs: HTTPRequest | AuthenticationRequest): EntityFieldDiff {
  const url = ours.url !== theirs.url
  const method = ours.method !== theirs.method
  const headers = snapshotDiffers(ours.headers, theirs.headers)
  const params = snapshotDiffers(ours.params, theirs.params)
  const pathParams = snapshotDiffers(ours.pathParams ?? [], theirs.pathParams ?? [])
  const body = snapshotDiffers(ours.body ?? null, theirs.body ?? null)
  const requestTabDiffers = [url, method, headers, params, pathParams, body].some(Boolean)

  let producedHeaders = false
  let expirationExpression = false
  let authErrorCodes = false
  if (isAuthRequest(ours) && isAuthRequest(theirs)) {
    producedHeaders = snapshotDiffers(ours.producedHeaders, theirs.producedHeaders)
    expirationExpression = (ours.expirationExpression ?? '') !== (theirs.expirationExpression ?? '')
    authErrorCodes = snapshotDiffers(ours.authErrorCodes, theirs.authErrorCodes)
  }
  const configTabDiffers = [producedHeaders, expirationExpression, authErrorCodes].some(Boolean)

  const notes = (ours.notes ?? '') !== (theirs.notes ?? '')

  // No dedicated tab/widget renders quick configs inside the conflict
  // panel yet (the live `RequestQuickSettingsButton` lives in the
  // workbench tab header, outside this view) — `quickConfigs` is exposed
  // for callers that want to know a real conflict exists, but it never
  // drives `preselectTabId` since there's nowhere to jump to.
  const quickConfigs = quickConfigsConflict(projectQuickConfigsOf(ours), projectQuickConfigsOf(theirs))

  const preselectTabId = requestTabDiffers ? 'request' : configTabDiffers ? 'configuration' : notes ? 'notes' : undefined
  const fields: Record<string, boolean> = { url, method, headers, params, pathParams, body, notes, quickConfigs }
  if (isAuthRequest(ours) && isAuthRequest(theirs)) {
    fields['producedHeaders'] = producedHeaders
    fields['expirationExpression'] = expirationExpression
    fields['authErrorCodes'] = authErrorCodes
  }
  return { fields, ...(preselectTabId ? { preselectTabId } : {}) }
}

/** Identity/metadata fields that are never part of "the request config" —
 * either not editable in this panel at all (renamed via the sidebar,
 * etc.), or handled as their own discrete field (`url`/`notes`) already. */
const REQUEST_NON_CONFIG_FIELDS = new Set([
  'id', 'name', 'icon', 'notes', 'tags', 'type', 'url',
  'authenticationRequestId', 'importOrigin', 'deprecated', 'removed',
  'quickConfigs', 'toPlainObject'
])

function omitFields(record: Record<string, unknown>, exclude: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!exclude.has(key)) out[key] = value
  }
  return out
}

/**
 * Generic field-diff for the protocols that don't (yet) have HTTP's
 * bespoke per-field breakdown — GraphQL / gRPC / SOAP / WebSocket / OData.
 * `url` and `notes` get their own discrete boolean (AC#4's own two named
 * examples); every other own field (query/variables, service/method,
 * headers/metadata, body, query options, …) is diffed as ONE coarse
 * `requestConfig` boolean — the same "coarse whole-section is acceptable
 * v1" latitude HTTP's headers/params/body Panes already use, just drawn
 * around the whole request-config area instead of per-section (these
 * protocols don't share HTTP's Pane-per-field layout).
 */
function computeGenericRequestFieldDiff(ours: Request, theirs: Request): EntityFieldDiff {
  const url = (ours as { url?: string }).url !== (theirs as { url?: string }).url
  const requestConfig = snapshotDiffers(
    omitFields(ours as unknown as Record<string, unknown>, REQUEST_NON_CONFIG_FIELDS),
    omitFields(theirs as unknown as Record<string, unknown>, REQUEST_NON_CONFIG_FIELDS)
  )
  const notes = (ours.notes ?? '') !== (theirs.notes ?? '')
  const preselectTabId = (url || requestConfig) ? 'request' : notes ? 'notes' : undefined
  return { fields: { url, requestConfig, notes }, ...(preselectTabId ? { preselectTabId } : {}) }
}

export function computeEntityFieldDiff(
  kind: GitEntityKind,
  ours: FolderItem,
  theirs: FolderItem
): EntityFieldDiff | undefined {
  if ((kind === 'folder' || kind === 'environmentFolder') && isAnyFolder(ours) && isAnyFolder(theirs)) {
    return computeFolderFieldDiff(ours, theirs)
  }
  if (kind === 'request' && isRequest(ours) && isRequest(theirs)) {
    let base: EntityFieldDiff | undefined
    if (isHTTPShaped(ours) && isHTTPShaped(theirs)) {
      base = computeRequestFieldDiff(ours, theirs)
    } else if (ours.type === theirs.type) {
      base = computeGenericRequestFieldDiff(ours, theirs)
    }
    if (!base) return undefined
    // Every request kind carries the ad-hoc `quickConfigs` field, so the
    // per-config conflict list applies to all of them, not just HTTP.
    const quickConfigNames = conflictingQuickConfigNames(projectQuickConfigsOf(ours), projectQuickConfigsOf(theirs))
    return quickConfigNames.length > 0 ? { ...base, conflictingQuickConfigNames: quickConfigNames } : base
  }
  return undefined
}
