/**
 * Global, ephemeral registry of the API-design ISSUES of each env-folder that
 * carries an `apiDocumentation` (an "API"). Drives the sidebar "!" indicator on
 * the env-folder row and the conditional "Issues" tab inside the env-folder
 * workbench. The API-level analogue of {@link ./secretItemStatusStore}.
 *
 * The source of truth is the main process: `ApiDesignValidationService` projects
 * each API's documentation into an ephemeral design, runs `validateApiDesign`,
 * and broadcasts `design:folder-issues-changed` per folder (empty array = clean).
 * This store keeps one app-wide subscription, seeded once with
 * `getFolderDesignIssues()` so a UI mounting after a background pass lights up
 * immediately. State is purely in-memory — never persisted.
 */

import { useSyncExternalStore } from 'react'
import type { DesignIssueView } from '../../../shared/design/describeDesignIssue'

const issuesByFolder = new Map<string, DesignIssueView[]>()
const listeners = new Set<() => void>()
let subscribed = false

const EMPTY: DesignIssueView[] = []

function notify(): void {
  for (const cb of listeners) cb()
}

function setIssues(folderId: string, next: DesignIssueView[]): void {
  if (next.length === 0) {
    if (!issuesByFolder.has(folderId)) return
    issuesByFolder.delete(folderId)
  } else {
    issuesByFolder.set(folderId, next)
  }
  notify()
}

function ensureSubscription(): void {
  if (subscribed) return
  const ctx = window.restorm?.context
  if (!ctx) return
  subscribed = true
  ctx.onFolderDesignIssues(({ folderId, issues }) => {
    setIssues(folderId, issues)
  })
  void ctx.getFolderDesignIssues().then((list) => {
    for (const entry of list) setIssues(entry.folderId, entry.issues)
  })
}

function subscribe(cb: () => void): () => void {
  ensureSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * React hook: the current API-design issues of a single env-folder. Returns a
 * stable empty array when the folder has no issues (or is not an API), so a
 * caller can render `issues.length > 0 ? … : null` without extra guards.
 */
export function useFolderDesignIssues(folderId: string | null | undefined): DesignIssueView[] {
  return useSyncExternalStore(
    subscribe,
    () => (folderId ? issuesByFolder.get(folderId) ?? EMPTY : EMPTY),
    () => EMPTY
  )
}
