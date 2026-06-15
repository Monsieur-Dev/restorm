/**
 * Global, ephemeral registry of the EFFECTIVE secret status of each tree ITEM
 * (request of any protocol, scenario) — does it currently resolve a secret
 * (spinner) and/or did its last resolution fail (red badge). Drives the badge
 * wherever an item appears: its workbench tab title, its sidebar row, a scenario
 * node. The item analogue of {@link ./secretResolutionStore} + {@link ./secretErrorStore}.
 *
 * The source of truth is the main process: `ContextService` resolves each item's
 * OWN (direct) secrets eagerly and combines them with the item's INHERITED active
 * environment chain, then broadcasts `context:item-secrets-status` per item. This
 * store keeps one app-wide subscription, seeded once with `getItemSecretStatuses()`
 * so a UI mounting mid-resolution lights up immediately. State is purely in-memory.
 */

import { useSyncExternalStore } from 'react'

interface ItemStatus { resolving: boolean; error: boolean }

const statuses = new Map<string, ItemStatus>()
const listeners = new Set<() => void>()
let subscribed = false

const EMPTY: ItemStatus = { resolving: false, error: false }

function notify(): void {
  for (const cb of listeners) cb()
}

function setStatus(itemId: string, next: ItemStatus): void {
  const prev = statuses.get(itemId)
  if (prev?.resolving === next.resolving && prev.error === next.error) return
  if (!next.resolving && !next.error) statuses.delete(itemId)
  else statuses.set(itemId, next)
  notify()
}

function ensureSubscription(): void {
  if (subscribed) return
  const ctx = window.restorm?.context
  if (!ctx) return
  subscribed = true
  ctx.onItemSecretsStatus(({ itemId, resolving, error }) => {
    setStatus(itemId, { resolving, error })
  })
  void ctx.getItemSecretStatuses().then((list) => {
    for (const s of list) setStatus(s.itemId, { resolving: s.resolving, error: s.error })
  })
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * React hook: the effective secret status of a single tree item. Returns a
 * stable `{ resolving, error }` — both `false` when the item has no secret in
 * flight or failed (direct OR inherited from its active environment).
 */
export function useItemSecretStatus(itemId: string | null | undefined): ItemStatus {
  return useSyncExternalStore(
    subscribe,
    () => (itemId ? statuses.get(itemId) ?? EMPTY : EMPTY),
    () => EMPTY
  )
}
