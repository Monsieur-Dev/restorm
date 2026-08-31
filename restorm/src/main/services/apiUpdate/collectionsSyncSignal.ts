/**
 * A monotonic counter of renderer→main `collections:sync` receipts, plus a
 * bounded waiter for "the next sync after a captured point".
 *
 * `create_project` / `open_project` use it to block until the renderer has
 * finished loading the freshly-opened project and mirrored it back, BEFORE
 * replying. Without that barrier an immediate follow-up MCP write races the
 * file-load: the load's `setRootItems(<file content>)` can land AFTER the
 * write's `mcp:tree-replace`, tearing the renderer tree back to the file's
 * (often empty) content while `appliedMcpVersion` still carries the write's
 * version. The renderer then mirrors that torn tree stamped at the advanced
 * version, which passes `CollectionStore.setCollections`' strictly-older guard
 * and clobbers the just-written items in the main store (open_tab then reports
 * "No item with id"). The existing `waitForCollectionStoreReady` only waits for
 * top-level environment-folder ids, so an empty (or env-folder-less) project
 * has nothing to wait for and this barrier fills that gap.
 *
 * The renderer's mirror effect lists `isFileServiceLoading` in its deps, so it
 * fires exactly one `collections:sync` when loading flips false — i.e. once the
 * file-load has settled — even for an empty project. Waiting for that sync is
 * the completion signal.
 */
let collectionsSyncCount = 0

interface SyncWaiter {
  threshold: number
  fire: () => void
}

const waiters: SyncWaiter[] = []

/** Record one renderer→main `collections:sync` receipt (applied or refused —
 * the arrival itself is the "renderer mirrored" signal) and release any waiter
 * whose threshold it reaches. */
export function noteCollectionsSync(): void {
  collectionsSyncCount += 1
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (collectionsSyncCount >= waiters[i].threshold) {
      const [waiter] = waiters.splice(i, 1)
      waiter.fire()
    }
  }
}

/** Current receipt count — capture it BEFORE triggering a file open, then pass
 * it to {@link waitForCollectionsSyncAfter}. */
export function getCollectionsSyncCount(): number {
  return collectionsSyncCount
}

/**
 * Resolve once at least one `collections:sync` has been received since
 * `sinceCount`, or after `timeoutMs` — this NEVER hangs. Returns whether a
 * sync actually arrived (`false` = timed out, so the caller can warn and let a
 * follow-up retry rather than block indefinitely).
 */
export function waitForCollectionsSyncAfter(sinceCount: number, timeoutMs: number): Promise<boolean> {
  if (collectionsSyncCount > sinceCount) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const waiter: SyncWaiter = {
      threshold: sinceCount + 1,
      fire: () => {
        clearTimeout(timer)
        resolve(true)
      }
    }
    const timer = setTimeout(() => {
      const idx = waiters.indexOf(waiter)
      if (idx >= 0) waiters.splice(idx, 1)
      resolve(false)
    }, timeoutMs)
    waiters.push(waiter)
  })
}
