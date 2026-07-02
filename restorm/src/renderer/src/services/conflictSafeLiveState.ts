/**
 * Blanket safety rule for the conflict-resolution 4-panel view (AC#2/#5):
 * a conflict panel renders a STATIC historical snapshot of `ours`/`theirs`
 * — never a live session — so it must never surface a live connection's
 * state or frames, even if the same request id happens to be genuinely
 * open + connected in a real workbench tab elsewhere at the same moment.
 *
 * GraphQL/gRPC/WebSocket each read a global "is this request id currently
 * listening/subscribing" store (keyed purely by `request.id`, with no
 * concept of "which render is the live one") and subscribe to a live
 * event stream filtered the same way. Every one of those call sites routes
 * the raw value through this single guard instead of using it directly,
 * so the rule lives in ONE place rather than three ad-hoc per-protocol
 * checks.
 */
export function conflictSafeBoolean(rawValue: boolean, conflictMode: boolean | undefined): boolean {
  return conflictMode ? false : rawValue
}

/**
 * Same rule for a live-event-stream subscription: in conflict mode, don't
 * subscribe at all (never call `subscribe`), so no live frame/message can
 * ever reach this render. Pass the effect's real subscribe callback as
 * `subscribe`; it's invoked only when NOT in conflict mode.
 */
export function subscribeUnlessConflictMode(conflictMode: boolean | undefined, subscribe: () => (() => void) | undefined): (() => void) | undefined {
  if (conflictMode) return undefined
  return subscribe()
}
