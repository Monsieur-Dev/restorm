import { isEnvironmentFolder } from '../../../shared/types/collections'
import type { EnvironmentFolder, FolderItem } from '../../../shared/types/collections'

/**
 * A rendered tree paired with the main-side model version it was built from.
 *
 * The pairing is the point. Main's `CollectionStore` accepts a `'user'` mirror
 * unless its stamp is strictly OLDER than the current model version, so a
 * payload that carries a version it was not built from is indistinguishable
 * from an up-to-date one — and wins.
 */
export interface MirrorPayload {
  /**
   * Env-folders only — the renderer's own `collections` state, whose consumers
   * (environment pickers, documentation, value-type groups) are all about
   * collections and nothing else.
   */
  collections: EnvironmentFolder[]
  /**
   * The WHOLE root, which is what gets mirrored to main.
   *
   * The root is not collections-only: the sidebar's "Ajouter ▸ Scénario" on the
   * empty area creates a scenario as a sibling of a collection, and a request
   * may sit there too. Main resolves a scenario BY ID out of this mirror when
   * the engine starts a run, so narrowing it to env-folders left a root
   * scenario absent from the main-side store entirely — the run then failed
   * with "no scenario with id", which names the symptom, not the cause.
   */
  rootItems: FolderItem[]
  builtFromVersion: number
}

/**
 * Pair `rootItems` with the model version it was built from.
 *
 * `builtFromVersion` must be a VALUE carried by the same render as
 * `rootItems` — never a ref read at send time. The renderer's mirror leaves
 * from an effect that runs after the render which produced the tree, and the
 * applied version advances the instant an `mcp:tree-replace` arrives, so
 * reading it late stamps a tree rendered BEFORE the replace with the version
 * that arrived AFTER it. Main's guard only refuses a strictly older stamp, so
 * such a payload is accepted and overwrites the authoritative tree — emptying
 * it outright if the stale render held no collections yet.
 *
 * Publishing the version as state alongside the tree (see
 * `useMcpTreeReplace`'s `onVersionApplied`, dispatched in the same handler as
 * `setRootItems`, so React commits both in one render) keeps the older version
 * attached to the older tree, and main refuses it on the comparison it already
 * implements.
 */
export function snapshotMirrorPayload(
  rootItems: FolderItem[],
  builtFromVersion: number
): MirrorPayload {
  return {
    collections: rootItems.filter(isEnvironmentFolder),
    rootItems,
    builtFromVersion
  }
}
