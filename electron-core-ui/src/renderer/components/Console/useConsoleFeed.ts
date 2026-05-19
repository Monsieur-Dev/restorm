import { useCallback, useSyncExternalStore } from 'react'
import type { ConsoleRecord } from './types'

/**
 * Renderer-side audit feed buffer for the Console panel. Module-level
 * singleton so the records survive across Console-tab remounts:
 * dragging the tab between workbench groups (or any other
 * reparenting) tears down + recreates the xterm component, but
 * `Console.tsx` reads its scrollback from this store on every render
 * — meaning a fresh mount immediately re-paints the entire history
 * rather than starting empty.
 *
 * The store is fed by an injected `ConsoleFeedSource` — the host app
 * calls `registerConsoleFeedSource(source)` once at renderer
 * bootstrap, wiring whatever IPC channel carries the records. The
 * store subscribes to that source lazily (the first time anyone
 * calls `useConsoleFeed`, or as soon as a source is registered if a
 * consumer is already mounted) so the audit log keeps filling even
 * when no Console tab is open. The buffer cap (10 000 records) bounds
 * memory; oldest drop off the front when exceeded. `clear()` empties
 * everything and notifies subscribers to re-render.
 *
 * One source subscription, one buffer, many subscribers — the
 * pattern matches React's `useSyncExternalStore` contract so
 * concurrent rendering stays consistent.
 */
export interface ConsoleFeedSource {
  onRecord(cb: (record: ConsoleRecord) => void): () => void
}

const BUFFER_LIMIT = 10_000

/**
 * The audit-feed buffer + rAF-batched snapshot store. The renderer
 * runs a single module-level instance (`registerConsoleFeedSource` /
 * `useConsoleFeed` / `clearConsoleFeed` operate on it). Exported so a
 * consuming app — or a test — can spin up an isolated instance.
 */
export class ConsoleFeedStore {
  // Mutable internal buffer — we never expose this directly, only
  // versioned snapshots cloned in `flush()`. Push + occasional trim
  // keep the per-record cost O(1) instead of O(n) array copies on
  // every event (which under sustained traffic was triggering
  // long-task warnings in DevTools — render thrash from re-cloning a
  // 10 000-element array per record).
  private buffer: ConsoleRecord[] = []
  private snapshot: ConsoleRecord[] = []
  private listeners = new Set<() => void>()
  private source: ConsoleFeedSource | null = null
  private sourceUnsub: (() => void) | null = null
  // rAF-batching: coalesce all records that land within a single
  // animation frame into one snapshot bump + one notify pass.
  // Keeps the renderer at one re-render per frame even when a
  // burst of records slams the feed.
  private flushHandle: number | null = null

  getSnapshot = (): ConsoleRecord[] => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.ensureSourceSubscription()
    return () => { this.listeners.delete(listener) }
  }

  clear = (): void => {
    if (this.buffer.length === 0 && this.snapshot.length === 0) return
    this.buffer = []
    this.snapshot = []
    this.notify()
  }

  /**
   * Register the IPC source the store pulls records from. Normally
   * called once at renderer bootstrap by the host. If a consumer
   * already subscribed before the source was wired, this kicks off the
   * source subscription immediately so no records are missed. Calling
   * it again (e.g. an HMR re-eval of the host's bootstrap module)
   * tears down the previous source's subscription before swapping —
   * otherwise the stale source would keep feeding and the new one
   * would never get subscribed.
   */
  setSource = (source: ConsoleFeedSource): void => {
    if (this.sourceUnsub !== null) {
      this.sourceUnsub()
      this.sourceUnsub = null
    }
    this.source = source
    if (this.listeners.size > 0) this.ensureSourceSubscription()
  }

  private ensureSourceSubscription(): void {
    if (this.sourceUnsub !== null || this.source === null) return
    this.sourceUnsub = this.source.onRecord((record) => { this.append(record) })
  }

  private append(record: ConsoleRecord): void {
    // A feed source may emit a placeholder record when a verdict
    // resolves (body still unknown) and re-emit the same `id` once
    // the body flushes. Dedupe by `id` so the second emit replaces
    // the first in place, otherwise every POST would surface as TWO
    // console lines. Walk from the tail since updates almost always
    // target the most-recent record.
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i]?.id === record.id) {
        this.buffer[i] = record
        this.scheduleFlush()
        return
      }
    }
    this.buffer.push(record)
    // Trim only when materially over the cap (BUFFER_LIMIT * 1.1)
    // so we amortise the splice-cost over many records instead
    // of paying O(n) on every push past the limit.
    const overshoot = this.buffer.length - BUFFER_LIMIT
    if (overshoot > BUFFER_LIMIT * 0.1) {
      this.buffer.splice(0, overshoot)
    }
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return
    this.flushHandle = requestAnimationFrame(() => {
      this.flushHandle = null
      this.flush()
    })
  }

  private flush(): void {
    // Trim down to the strict cap before snapshotting so consumers
    // never see beyond `BUFFER_LIMIT` records, even during the
    // hysteresis window where `append` left the buffer oversize.
    if (this.buffer.length > BUFFER_LIMIT) {
      this.buffer.splice(0, this.buffer.length - BUFFER_LIMIT)
    }
    this.snapshot = this.buffer.slice()
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

// Pin the store to `globalThis` so HMR (which re-evaluates this
// module) doesn't drop the records buffer. Without the pin, every
// HMR pass creates a fresh `ConsoleFeedStore` and the new store
// starts empty — meaning a hot-update for any file in the Console
// tree wipes the user's accumulated audit feed mid-session. In
// production there's no HMR, so the singleton lives for the lifetime
// of the renderer regardless. The bracket-key avoids the type
// acrobatics of declaring a property on `globalThis`.
const STORE_GLOBAL_KEY = '__ecuiConsoleFeedStore__'
const globalRef = globalThis as unknown as Record<string, ConsoleFeedStore | undefined>
const store: ConsoleFeedStore = globalRef[STORE_GLOBAL_KEY] ?? (globalRef[STORE_GLOBAL_KEY] = new ConsoleFeedStore())

/**
 * Wire the Console feed to an IPC source. Call once at renderer
 * bootstrap, passing the slice of the host's preload API that streams
 * records (e.g. `{ onRecord: window.api.firewall.onRecord }`).
 */
export function registerConsoleFeedSource(source: ConsoleFeedSource): void {
  store.setSource(source)
}

export function useConsoleFeed(): {
  records: ConsoleRecord[]
  clear: () => void
} {
  const records = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const clear = useCallback(() => { store.clear() }, [])
  return { records, clear }
}

/**
 * Imperative escape hatch: wipe the singleton store from outside a
 * component. Used by the host's `console_clear` MCP bridge where
 * there's no `useConsoleFeed()` call site to hold the hook's `clear`
 * over — the IPC handler needs a stable reference it can invoke from
 * anywhere.
 */
export function clearConsoleFeed(): void {
  store.clear()
}
