/**
 * Global, ephemeral registry of which ENVIRONMENTS are currently resolving at
 * least one secret variable — drives the "resolving" spinner wherever an env or
 * its env-folder appears (workbench tab, env-folder sidebar entry, the
 * Environnements sub-tab, the environment list row).
 *
 * The source of truth is the main process: `ContextService` hydrates an env's
 * secrets (on open + on refresh) and broadcasts `context:env-secrets-resolving`
 * at the start/end. This store keeps a single app-wide subscription to that
 * stream, seeded once with `getResolvingEnvironments()` so a UI mounting
 * mid-resolution lights up immediately. State is purely in-memory.
 */

import { useSyncExternalStore } from 'react'

// Environments currently resolving at least one secret.
const resolving = new Set<string>()
const listeners = new Set<() => void>()
let subscribed = false

function notify(): void {
  for (const cb of listeners) cb()
}

function setResolving(environmentId: string, isResolving: boolean): void {
  const had = resolving.has(environmentId)
  if (isResolving === had) return
  if (isResolving) resolving.add(environmentId)
  else resolving.delete(environmentId)
  notify()
}

/** Wire the single app-wide subscription + seed. Idempotent + retried on each
 * `subscribe` until the preload bridge is available (components mount after
 * preload, so this lands on the first real subscriber). */
function ensureSubscription(): void {
  if (subscribed) return
  const ctx = window.restorm?.context
  if (!ctx) return
  subscribed = true
  ctx.onEnvSecretsResolving(({ environmentId, resolving: isResolving }) => {
    setResolving(environmentId, isResolving)
  })
  void ctx.getResolvingEnvironments().then((ids) => {
    for (const id of ids) setResolving(id, true)
  })
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: `true` while ANY of the given environments is resolving a secret.
 * Pass an env-folder's full env-id list for the folder-level spinner, or a
 * single id for one environment. */
export function useAnyEnvResolving(environmentIds: readonly string[]): boolean {
  // Snapshot is a primitive boolean → stable across renders when unchanged.
  return useSyncExternalStore(
    subscribe,
    () => environmentIds.some((id) => resolving.has(id)),
    () => false
  )
}
