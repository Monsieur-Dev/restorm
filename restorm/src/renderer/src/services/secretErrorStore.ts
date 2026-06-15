/**
 * Global, ephemeral registry of which ENVIRONMENTS last FAILED to resolve at
 * least one secret variable — drives the error badge wherever an env or its
 * env-folder appears (workbench tab, env-folder sidebar entry, the
 * Environnements sub-tab, the environment list row). The mirror image of
 * {@link ./secretResolutionStore} (the resolving spinner).
 *
 * The source of truth is the main process: `ContextService` stamps an error
 * verdict at the end of each env hydration and broadcasts
 * `context:env-secrets-error` (hasError true/false). A re-resolution clears the
 * verdict at its start, so the badge disappears while a retry is in flight and
 * only re-appears if the retry fails again. This store keeps a single app-wide
 * subscription to that stream, seeded once with `getErroredEnvironments()` so a
 * UI mounting after a failure lights up immediately. State is purely in-memory.
 */

import { useSyncExternalStore } from 'react'

// Environments whose last secret resolution failed.
const errored = new Set<string>()
const listeners = new Set<() => void>()
let subscribed = false

function notify(): void {
  for (const cb of listeners) cb()
}

function setErrored(environmentId: string, hasError: boolean): void {
  const had = errored.has(environmentId)
  if (hasError === had) return
  if (hasError) errored.add(environmentId)
  else errored.delete(environmentId)
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
  ctx.onEnvSecretsError(({ environmentId, hasError }) => {
    setErrored(environmentId, hasError)
  })
  void ctx.getErroredEnvironments().then((ids) => {
    for (const id of ids) setErrored(id, true)
  })
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** React hook: `true` when ANY of the given environments last failed to resolve
 * a secret. Pass an env-folder's full env-id list for the folder-level badge, or
 * a single id for one environment. */
export function useAnyEnvError(environmentIds: readonly string[]): boolean {
  return useSyncExternalStore(
    subscribe,
    () => environmentIds.some((id) => errored.has(id)),
    () => false
  )
}
