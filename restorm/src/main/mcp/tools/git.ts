/**
 * Pro-gated MCP git routes — a 2-step commit+push confirm flow
 * (`git_commit_push` → `git_confirm_push`) and a pull flow with
 * ZOD-validated conflict resolution (`git_pull` → `git_resolve_conflicts`).
 * See `docs/Git/README.md`'s "Commit-message generation" section for the
 * shared diff/message pipeline these routes drive.
 *
 * Reuses the SAME process-neutral pure logic the renderer's Push modal
 * (`usePushModal.ts`) and 4-panel conflict view (`useGitPullConflict.ts`)
 * are built on (`shared/git/*`) — an agent reviewing/confirming a commit,
 * or resolving a pull conflict, drives the exact same diff / message /
 * merge engine a human does, just through a different front door. Gated
 * behind the `git.client` capability (see `mcpProGate.ts`); a Community
 * agent gets the standard Pro refusal on every route below before any
 * handler here even runs.
 *
 * `git_commit_push`'s diff "after" side is `collectionStore.getCollections()`
 * (main's in-memory mirror) — the SAME choice `usePushModal.ts` makes with
 * the renderer's live `rootItems` (not a disk read): both sides accept
 * that the diff previews the in-memory model, and rely on autosave having
 * flushed to disk by commit time (nudged, not awaited, via
 * `broadcastSaveTrigger` — save runs in the renderer; see `project.ts`'s
 * `save_project` for the same fire-and-forget characteristic).
 */

import { z } from 'zod'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { BrowserWindow } from 'electron'
import {
  McpService,
  getGitService,
  getFileService,
  isFileServiceInitialized,
  getSettingsService,
  isSettingsServiceInitialized,
  i18nService,
  renderCommitMessage
} from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import type { FolderItem } from '../../../shared/types/folderTypes'
import { diffProjectEntities, parseProjectYaml, flattenEntities, ownFieldsSnapshot, type GitEntityChange } from '../../../shared/git/gitCommitDiff'
import { buildCommitMessageContext } from '../../../shared/git/commitMessageContext'
import { RESTORM_COMMIT_MESSAGE_TEMPLATE } from '../../../shared/git/commitMessageTemplates'
import { identifyConflictingEntities, type ConflictEntity } from '../../../shared/git/gitConflictModel'
import { buildMergedProjectTree } from '../../../shared/git/gitConflictMerge'
import { prepareForSerialization } from '../../../shared/utils/serialization'
import {
  setPendingCommitReview,
  getPendingCommitReview,
  clearPendingCommitReview,
  setPendingConflictResolution,
  getPendingConflictResolution,
  clearPendingConflictResolution
} from '../gitMcpState'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function broadcastSaveTrigger(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('file:autosave-trigger')
  }
}

/** The `git` group's storage key for the commit-message language setting
 * (`buildSettingsStorageKey(['git'], 'commitMessageLanguage')` —
 * Push-modal-only, no visible Settings→Git row; see `usePushModal.ts`). */
const COMMIT_MESSAGE_LANGUAGE_SETTING = 'git:commitMessageLanguage'
const DEFAULT_COMMIT_MESSAGE_LANGUAGE = 'en'

function resolveCommitMessageLanguage(override: unknown): string {
  if (typeof override === 'string' && override !== '') return override
  if (!isSettingsServiceInitialized()) return DEFAULT_COMMIT_MESSAGE_LANGUAGE
  const stored = getSettingsService().get(COMMIT_MESSAGE_LANGUAGE_SETTING)
  return typeof stored === 'string' && stored !== '' ? stored : DEFAULT_COMMIT_MESSAGE_LANGUAGE
}

/** Resolve the active project's git folder + the open file's path relative
 * to it, or `null` when there's no open single-file project inside a git
 * folder — every route below refuses cleanly in that case rather than
 * throwing. Mirrors `useGitFolder.ts` / `usePushModal.ts`'s own mapping;
 * `getGitService().getActiveFolder()` is the SAME state
 * `src/main/index.ts`'s `file:opened` wiring already keeps current, so
 * this never needs to re-derive it from the file path. */
function resolveGitTarget(): { gitFolder: string, relativePath: string } | null {
  const gitFolder = getGitService().getActiveFolder()
  const filePath = isFileServiceInitialized() ? getFileService().getFilePath() : null
  if (!gitFolder || !filePath?.endsWith('.restorm')) return null
  return { gitFolder, relativePath: filePath.slice(gitFolder.length + 1) }
}

/** Per-changed-entity before/after own-field snapshots — the ticket's
 * "before/after payloads" (AC#1): richer than the bare `{kind,name,action}`
 * change line, so an agent reviewing a "modified" entity can see WHAT
 * changed, not just that it did. Looked up from the same flattened maps
 * `diffProjectEntities` builds internally, without changing that
 * function's public shape (its other caller, `usePushModal.ts`, doesn't
 * need this). */
function enrichWithBeforeAfter(
  changes: GitEntityChange[],
  beforeItems: FolderItem[],
  afterItems: FolderItem[]
): (GitEntityChange & { before?: unknown, after?: unknown })[] {
  const before = flattenEntities(beforeItems)
  const after = flattenEntities(afterItems)
  return changes.map((change) => {
    // `diffProjectEntities` diffs by id, but doesn't hand the id back out
    // in `GitEntityChange` (kind/name/action only) — re-find it by kind +
    // name here. A same-kind/same-name collision would only mis-pair the
    // before/after payload cosmetically (the change line itself is still
    // correct); acceptable for this enrichment, not worth threading ids
    // through the shared diff engine's public contract for.
    const beforeEntry = [...before.values()].find((e) => e.kind === change.kind && e.name === change.name)
    const afterEntry = [...after.values()].find((e) => e.kind === change.kind && e.name === change.name)
    return {
      ...change,
      ...(change.action !== 'added' && beforeEntry ? { before: JSON.parse(ownFieldsSnapshot(beforeEntry.item)) as unknown } : {}),
      ...(change.action !== 'deleted' && afterEntry ? { after: JSON.parse(ownFieldsSnapshot(afterEntry.item)) as unknown } : {})
    }
  })
}

export function registerGitTools(mcp: McpService): void {
  mcp.registerTool(
    'git_commit_push',
    {
      titleKey: 'mcpToolTitles.gitCommitPush',
      title: 'Review a commit before pushing',
      description:
        'Step 1/2 of the commit+push flow (Restorm Pro). Computes the structural diff since the last ' +
        'commit and generates a commit message (deterministic, no LLM inside Restorm) in the given or ' +
        'configured language. Returns a `reviewToken` + the generated `title`/`body` + the per-entity ' +
        '`changes` (with before/after own-field snapshots) — NO write happens yet. Call `git_confirm_push` ' +
        'with the token to actually commit + push, optionally editing the message first.',
      inputSchema: {
        language: z.string().optional().describe(
          'Commit-message language (e.g. "en", "fr"). Defaults to the user\'s configured commit-message language, or English.'
        )
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const target = resolveGitTarget()
      if (!target) return errorReply('No open single-file (.restorm) project inside a git folder.')
      const { gitFolder, relativePath } = target

      const rawYaml = await getGitService().getFileAtHead(gitFolder, relativePath)
      const beforeItems = parseProjectYaml(rawYaml)
      const afterItems: FolderItem[] = collectionStore.getCollections()
      const changes = diffProjectEntities(beforeItems, afterItems)
      if (changes.length === 0) {
        return jsonReply({ hasChanges: false, message: 'Nothing to commit — the project matches the last commit.' })
      }

      const language = resolveCommitMessageLanguage(argRecord['language'])
      const t = i18nService.getFixedT(language)
      const context = buildCommitMessageContext(changes, t)
      const rendered = renderCommitMessage(RESTORM_COMMIT_MESSAGE_TEMPLATE, context)

      const pending = setPendingCommitReview({ gitFolder, relativePath, changes, title: rendered.title, body: rendered.body })
      return jsonReply({
        hasChanges: true,
        reviewToken: pending.token,
        title: rendered.title,
        body: rendered.body,
        changes: enrichWithBeforeAfter(changes, beforeItems, afterItems)
      })
    }
  )

  mcp.registerTool(
    'git_confirm_push',
    {
      titleKey: 'mcpToolTitles.gitConfirmPush',
      title: 'Confirm and land a reviewed commit',
      description:
        'Step 2/2 of the commit+push flow (Restorm Pro). Confirms the `reviewToken` from `git_commit_push` ' +
        'and commits + pushes. `title`/`body` optionally OVERRIDE the generated message — this is the ONLY ' +
        'place an external agent shapes the commit message; nothing inside Restorm runs an LLM. Refuses if ' +
        'the project changed since the review (re-call `git_commit_push` to get an up-to-date one).',
      inputSchema: {
        reviewToken: z.string().min(1).describe('The `reviewToken` returned by `git_commit_push`.'),
        title: z.string().optional().describe('Override the generated commit title.'),
        body: z.string().optional().describe('Override the generated commit body.')
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const reviewToken = typeof argRecord['reviewToken'] === 'string' ? argRecord['reviewToken'] : ''
      const pending = getPendingCommitReview()
      if (pending?.token !== reviewToken) {
        return errorReply('No matching pending commit review — call git_commit_push first.')
      }

      const rawYaml = await getGitService().getFileAtHead(pending.gitFolder, pending.relativePath)
      const beforeItems = parseProjectYaml(rawYaml)
      const afterItems: FolderItem[] = collectionStore.getCollections()
      const freshChanges = diffProjectEntities(beforeItems, afterItems)
      if (JSON.stringify(freshChanges) !== JSON.stringify(pending.changes)) {
        clearPendingCommitReview()
        return errorReply('The project changed since git_commit_push was called — call it again to get an up-to-date review.')
      }

      const title = typeof argRecord['title'] === 'string' && argRecord['title'] !== '' ? argRecord['title'] : pending.title
      const body = typeof argRecord['body'] === 'string' ? argRecord['body'] : pending.body
      const message = body ? `${title}\n\n${body}` : title

      broadcastSaveTrigger()
      await getGitService().stage(pending.gitFolder, [pending.relativePath])
      const commitResult = await getGitService().commit(pending.gitFolder, message)
      if (!commitResult.success) {
        clearPendingCommitReview()
        return errorReply(`Commit failed: ${commitResult.error ?? 'unknown error'}`)
      }
      const pushResult = await getGitService().push(pending.gitFolder)
      clearPendingCommitReview()
      if (!pushResult.success) {
        return errorReply(`Committed locally (${commitResult.commit ?? ''}) but push failed: ${pushResult.error ?? 'unknown error'}`)
      }
      return jsonReply({ committed: true, commit: commitResult.commit, pushed: true })
    }
  )

  mcp.registerTool(
    'git_pull',
    {
      titleKey: 'mcpToolTitles.gitPull',
      title: 'Pull the latest changes',
      description:
        'Pull from the upstream branch (Restorm Pro). On success with no conflicts, returns `{ pulled: true }`. ' +
        'On a conflicted pull, returns the conflict list (one entry per genuinely-conflicting entity — request / ' +
        'scenario / folder / environment-folder) plus a `resolutionToken`. Call `git_resolve_conflicts` with the ' +
        'token + a pick per conflict to finish the merge.',
      inputSchema: {} as Record<string, unknown>
    },
    async () => {
      const target = resolveGitTarget()
      if (!target) return errorReply('No open single-file (.restorm) project inside a git folder.')
      const { gitFolder, relativePath } = target

      const pullResult = await getGitService().pull(gitFolder)
      if (pullResult.success) {
        return jsonReply({ pulled: true, conflicted: false })
      }
      if (!pullResult.conflicted) {
        return errorReply(`Pull failed: ${pullResult.error ?? 'unknown error'}`)
      }

      const [versions, commitTimestamps] = await Promise.all([
        getGitService().getConflictVersions(gitFolder, relativePath),
        getGitService().getConflictCommitTimestamps(gitFolder)
      ])
      const conflicts = identifyConflictingEntities(versions)
      const pending = setPendingConflictResolution({ gitFolder, relativePath, versions, conflicts, commitTimestamps })
      return jsonReply({
        pulled: false,
        conflicted: true,
        resolutionToken: pending.token,
        conflicts: conflicts.map((c) => ({ id: c.id, kind: c.kind, name: c.name, ours: c.ours, theirs: c.theirs }))
      })
    }
  )

  mcp.registerTool(
    'git_resolve_conflicts',
    {
      titleKey: 'mcpToolTitles.gitResolveConflicts',
      title: 'Resolve a pull conflict',
      description:
        'Finish a conflicted pull (Restorm Pro) — the `resolutionToken` from `git_pull` plus a `pick` ' +
        '("ours" or "theirs") for EVERY conflict it listed. v1 is pick-a-side only, no free-form field edits ' +
        'through this route (matches the 4-panel UI\'s primary "select user/server" action). Writes the merged ' +
        'project + commits; does not push (mirrors the app\'s own conflict-resolution flow).',
      inputSchema: {
        resolutionToken: z.string().min(1).describe('The `resolutionToken` returned by `git_pull`.'),
        resolutions: z.array(z.object({
          id: z.string().min(1).describe('A conflict id from `git_pull`\'s `conflicts` list.'),
          pick: z.enum(['ours', 'theirs']).describe('Which side wins this conflict.')
        })).min(1).describe('One resolution per conflict `git_pull` returned — every listed conflict must be covered.')
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const resolutionToken = typeof argRecord['resolutionToken'] === 'string' ? argRecord['resolutionToken'] : ''
      const pending = getPendingConflictResolution()
      if (pending?.token !== resolutionToken) {
        return errorReply('No matching pending conflict resolution — call git_pull first.')
      }

      const rawResolutions = Array.isArray(argRecord['resolutions']) ? argRecord['resolutions'] : []
      const pickById = new Map<string, 'ours' | 'theirs'>()
      for (const entry of rawResolutions) {
        if (entry !== null && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
          const pick = (entry as { pick?: unknown }).pick
          if (pick === 'ours' || pick === 'theirs') pickById.set((entry as { id: string }).id, pick)
        }
      }

      const unknownIds = [...pickById.keys()].filter((id) => !pending.conflicts.some((c) => c.id === id))
      if (unknownIds.length > 0) {
        return errorReply(`Unknown conflict id(s), not part of the current pull: ${unknownIds.join(', ')}`)
      }
      const missing = pending.conflicts.filter((c) => !pickById.has(c.id))
      if (missing.length > 0) {
        return errorReply(`Missing a resolution for: ${missing.map((c) => `${c.id} (${c.name})`).join(', ')}`)
      }

      const resolvedById: Record<string, FolderItem> = {}
      const conflictById = new Map<string, ConflictEntity>(pending.conflicts.map((c) => [c.id, c]))
      for (const [id, pick] of pickById) {
        const conflict = conflictById.get(id)
        if (conflict) resolvedById[id] = pick === 'ours' ? conflict.ours : conflict.theirs
      }

      const oursItems = parseProjectYaml(pending.versions.ours)
      const theirsItems = parseProjectYaml(pending.versions.theirs)
      const merged = buildMergedProjectTree(oursItems, theirsItems, resolvedById, pending.commitTimestamps)

      // Splice the merged tree into the FULL `ours` document rather than
      // rebuilding `{ collections: merged }` from scratch — `ours` carries
      // top-level project fields beyond `collections` (notably
      // `_projectUuid`); dropping it would orphan the DraftStore on next
      // open. Mirrors `useGitPullConflict.ts`'s own write-back exactly.
      const oursDocument = pending.versions.ours !== null ? (yamlParse(pending.versions.ours) as Record<string, unknown> | null) : null
      const mergedDocument = { ...(oursDocument ?? {}), collections: merged }
      const yamlText = yamlStringify(prepareForSerialization(mergedDocument))

      await getGitService().writeResolvedConflict(pending.gitFolder, pending.relativePath, yamlText)
      const commitResult = await getGitService().commit(pending.gitFolder, i18nService.t('git.conflictResolvedCommitMessage'))
      if (!commitResult.success) {
        return errorReply(`Resolution written but commit failed: ${commitResult.error ?? 'unknown error'}`)
      }
      clearPendingConflictResolution()
      return jsonReply({ resolved: true, commit: commitResult.commit })
    }
  )
}
