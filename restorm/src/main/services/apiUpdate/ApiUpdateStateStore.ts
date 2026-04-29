import type { ApiUpdateState } from '../../../shared/types/baseTypes'

type Listener = (folderId: string, state: ApiUpdateState) => void

/**
 * In-memory store of `ApiUpdateState` per env folder. The state is
 * deliberately not persisted — the scheduler re-derives the right
 * value on each tick from the persisted `apiUpdate.lastImportedSpec*`
 * markers, so a restart simply triggers a fresh `firstCheck` /
 * `unchanged` round and any stale `'available'` toast disappears
 * along with the previous session.
 *
 * Subscribers receive every transition; the IPC layer wraps a
 * `webContents.send` around `subscribe()` so the renderer can keep
 * its badges + toasts in sync.
 */
class ApiUpdateStateStore {
  private states = new Map<string, ApiUpdateState>()
  private listeners = new Set<Listener>()

  get(folderId: string): ApiUpdateState {
    return this.states.get(folderId) ?? { kind: 'idle' }
  }

  /**
   * Replace the current state for `folderId` and notify subscribers.
   * The store stores by reference, so callers must not mutate the
   * passed object after handing it over.
   */
  set(folderId: string, state: ApiUpdateState): void {
    this.states.set(folderId, state)
    for (const listener of this.listeners) listener(folderId, state)
  }

  /**
   * Patch a subset of fields onto the existing state. Convenience for
   * partial transitions like "now we're checking, keep the
   * lastCheckedAt I had".
   */
  patch(folderId: string, patch: Partial<ApiUpdateState>): ApiUpdateState {
    const next = { ...this.get(folderId), ...patch }
    this.set(folderId, next)
    return next
  }

  /** Snapshot of every known folderId → state. Used by the IPC
   * `getState` initial sync when the renderer mounts. */
  snapshot(): Record<string, ApiUpdateState> {
    const out: Record<string, ApiUpdateState> = {}
    for (const [id, state] of this.states) out[id] = state
    return out
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Drop everything. Called when a project file closes; the next
   * project will start with a fresh map. */
  clear(): void {
    this.states.clear()
    for (const listener of this.listeners) listener('*', { kind: 'idle' })
  }
}

export const apiUpdateStateStore = new ApiUpdateStateStore()
export type { ApiUpdateStateStore }
