import type { FolderItem } from '../../../shared/types/folderTypes'
import { isScenario } from '../../../shared/types/folderTypes'
import { makeReactiveFolderItem } from '../types/reactive'

/**
 * Produce an independent, editable copy of a conflict entity for the
 * resolved panel — a deep clone so editing it can never mutate the `ours`/
 * `theirs` snapshots the user/server (read-only) panels still display.
 *
 * Folders / environment-folders / requests are wrapped via
 * `makeReactiveFolderItem` — the SAME reactive-proxy mechanism the live
 * editor uses, so their normal panel (`FolderView`, `HTTPRequestTabView`,
 * …) can mutate fields in place exactly like it does for the real tree.
 * Scenarios are NOT reactively wrapped by that helper (by design — see
 * its own comment): `ScenarioEditorView` is controlled via its
 * `onScenarioChange(scenarioId, patch)` callback instead, so a plain deep
 * clone is enough; the caller applies patches with a normal state update.
 */
export function cloneEntityForResolution(item: FolderItem): FolderItem {
  const clone = structuredClone(item)
  return isScenario(clone) ? clone : makeReactiveFolderItem(clone)
}
