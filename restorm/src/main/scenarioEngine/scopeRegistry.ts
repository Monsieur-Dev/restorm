/**
 * Tracks open scopes opened by `forEach` activations.
 *
 * Every time a `forEach` fires, it opens N child scopes (one per
 * item). Each scope is identified by the full scope stack — a list
 * of `(scopeNodeId, index)` frames inherited from the parent + the
 * new frame.
 *
 * A scope stays open as long as at least one activation downstream of
 * the `forEach` is in flight at that scope path. When the last one
 * completes, the scope **closes**. The `aggregate` node listens for
 * close signals on its bound `forEach` scope to collect partial
 * results.
 *
 * Counts are maintained by `Scheduler` on every enqueue / completion
 * — this class is just the bookkeeping + close-listener registry.
 */

import type { ScopeStack } from './types'

/** Stable key for a scope path so JS Maps can use it as an index. */
export function scopeKey(scope: ScopeStack): string {
  if (scope.length === 0) return ''
  return scope.map((f) => `${f.scopeNodeId}#${f.index}`).join('/')
}

/** Listener fired exactly once when a scope closes (its in-flight
 * counter reaches 0 after having been non-zero at least once). */
export type ScopeCloseListener = (scope: ScopeStack) => void

interface ScopeEntry {
  scope: ScopeStack
  inFlight: number
  /** Total activations that ever entered this scope — used by aggregate
   * to know how many items the parent `forEach` produced. */
  totalEntered: number
  listeners: ScopeCloseListener[]
}

export class ScopeRegistry {
  private readonly scopes = new Map<string, ScopeEntry>()

  /** Called by the scheduler when an activation is enqueued at the
   * given scope. Increments both the in-flight counter and the
   * lifetime "entered" counter. */
  enter(scope: ScopeStack): void {
    const key = scopeKey(scope)
    const entry = this.scopes.get(key)
    if (entry) {
      entry.inFlight += 1
      entry.totalEntered += 1
    } else {
      this.scopes.set(key, { scope, inFlight: 1, totalEntered: 1, listeners: [] })
    }
  }

  /** Called by the scheduler when an activation at the given scope
   * completes (or fails) — decrements the in-flight counter, and
   * fires close listeners if it reaches 0. The entry is kept so that
   * a late aggregate registration can still read `totalEntered`. */
  leave(scope: ScopeStack): void {
    const key = scopeKey(scope)
    const entry = this.scopes.get(key)
    if (!entry) return
    entry.inFlight = Math.max(0, entry.inFlight - 1)
    if (entry.inFlight === 0) {
      const listeners = entry.listeners.splice(0)
      for (const cb of listeners) {
        try { cb(scope) } catch { /* a listener throwing should never bring down the scheduler */ }
      }
    }
  }

  /** Register a one-shot listener that fires when the scope's
   * in-flight count reaches 0. If the scope is already closed (or
   * never opened), the listener fires synchronously. */
  onClose(scope: ScopeStack, cb: ScopeCloseListener): void {
    const key = scopeKey(scope)
    const entry = this.scopes.get(key)
    if (!entry || entry.inFlight === 0) {
      try { cb(scope) } catch { /* swallow */ }
      return
    }
    entry.listeners.push(cb)
  }

  /** How many activations were ever queued at this scope. Aggregate
   * uses this to know how many partial results to expect. */
  totalEntered(scope: ScopeStack): number {
    return this.scopes.get(scopeKey(scope))?.totalEntered ?? 0
  }

  /** Snapshot of every open scope — useful for status / debug. */
  openScopes(): ScopeStack[] {
    const out: ScopeStack[] = []
    for (const entry of this.scopes.values()) {
      if (entry.inFlight > 0) out.push(entry.scope)
    }
    return out
  }
}
