/**
 * A tiny in-renderer bus to centre a scenario box when navigating to it from
 * elsewhere (e.g. the request editor's "used in scenarios" link). Two delivery
 * paths cover both timings:
 *  - the scenario tab is already open → a live listener fires immediately;
 *  - the tab is opening fresh → the editor reads the pending request on mount.
 * The request is consumed once, so a focus never re-fires on a later remount.
 */
type FocusListener = (scenarioId: string, nodeId: string) => void

const pending = new Map<string, string>()
const listeners = new Set<FocusListener>()

/** Ask the editor showing `scenarioId` to centre on `nodeId`. */
export function requestScenarioNodeFocus(scenarioId: string, nodeId: string): void {
  pending.set(scenarioId, nodeId)
  for (const listener of listeners) listener(scenarioId, nodeId)
}

/** Read + clear any pending focus for a scenario (called by the editor on mount). */
export function consumePendingScenarioNodeFocus(scenarioId: string): string | undefined {
  const nodeId = pending.get(scenarioId)
  if (nodeId !== undefined) pending.delete(scenarioId)
  return nodeId
}

/** Subscribe to focus requests for an already-mounted editor. Returns an
 * unsubscribe. The listener should clear the pending entry once it acts. */
export function onScenarioNodeFocus(listener: FocusListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Drop a pending focus that a live listener already handled. */
export function clearPendingScenarioNodeFocus(scenarioId: string): void {
  pending.delete(scenarioId)
}
