/**
 * Validates the DESIGN of every API in the open project, in the MAIN process,
 * and pushes the resulting issues to the renderer per env-folder id.
 *
 * An "API" is an {@link EnvironmentFolder} that carries an `apiDocumentation`
 * (that is what distinguishes it from a plain folder). Its documentation is
 * projected into an ephemeral in-memory {@link ApiDesign} with
 * `designFromDocumentation`, then run through `validateApiDesign` — the SAME
 * checks the API designer applies (duplicate routes, clashing model/enum names,
 * dangling references, …). The temporary design is discarded; only the
 * `DesignIssue[]` is kept and broadcast.
 *
 * The pass runs on the events that change an API's documentation — a project
 * (re)load and a folder update (import commit, API update) — never on the
 * renderer's hot path. The renderer mirrors the per-folder issues through
 * {@link ../../renderer/src/services/folderDesignIssuesStore} to drive the
 * sidebar "!" indicator and the env-folder "Issues" tab. This is the API-level
 * analogue of {@link ./ContextService}'s per-item secret-status pipeline.
 */

import { BrowserWindow } from 'electron'
import { eventBusService, logger } from 'electron-core-ui/main'
import { DocumentEvents, type DocumentChangedPayload } from './DocumentEvents'
import { collectionStore } from './CollectionStore'
import { isEnvironmentFolder, isAnyFolder } from '../../shared/types/folderTypes'
import type { EnvironmentFolder, FolderItem } from '../../shared/types/folderTypes'
import { designFromDocumentation } from '../../shared/design/designFromDocumentation'
import { mergeEnumDefinitionsIntoModels } from '../../shared/design/mergeEnumDefinitions'
import { validateApiDesign } from '../../shared/design/validateApiDesign'
import { describeDesignIssue, type DesignIssueView } from '../../shared/design/describeDesignIssue'

/** Channel: a folder's API-design issues changed (empty array = now clean). */
export const FOLDER_DESIGN_ISSUES_CHANNEL = 'design:folder-issues-changed'

export interface FolderDesignIssues {
  folderId: string
  issues: DesignIssueView[]
}

class ApiDesignValidationService {
  /** folderId → its current API-design issues. Absent = no issues. */
  private readonly issuesByFolder = new Map<string, DesignIssueView[]>()
  private initialized = false

  initialize(): void {
    if (this.initialized) return
    // A full (re)load of the tree — file open, and the tree the renderer commits
    // after an import — re-validates every API.
    collectionStore.onCollectionsSet(() => { this.revalidateAll() })
    // A single folder mutation — an API update (re-import) refreshes one API's
    // documentation in place and fires FOLDER_UPDATED.
    eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.FOLDER_UPDATED, (payload) => {
      this.revalidateFolder(payload.id)
    })
    this.initialized = true
    logger.info('[ApiDesignValidationService] Initialized')
  }

  /** Snapshot for a renderer mounting mid-session (seeds its store). */
  getFolderIssues(): FolderDesignIssues[] {
    return [...this.issuesByFolder.entries()].map(([folderId, issues]) => ({ folderId, issues }))
  }

  private revalidateAll(): void {
    const apis = this.collectApiFolders()
    const seen = new Set<string>()
    for (const folder of apis) {
      seen.add(folder.id)
      this.validateAndStore(folder)
    }
    // Drop stale entries — a folder that was removed or lost its documentation.
    for (const folderId of [...this.issuesByFolder.keys()]) {
      if (!seen.has(folderId)) this.setFolderIssues(folderId, [])
    }
  }

  private revalidateFolder(folderId: string): void {
    const item = collectionStore.findById(folderId)
    if (item !== null && isEnvironmentFolder(item) && item.apiDocumentation !== undefined) {
      this.validateAndStore(item)
    } else {
      this.setFolderIssues(folderId, [])
    }
  }

  private validateAndStore(folder: EnvironmentFolder): void {
    const doc = folder.apiDocumentation
    if (doc === undefined) {
      this.setFolderIssues(folder.id, [])
      return
    }
    let issues: DesignIssueView[] = []
    try {
      // Merge the env-folder's sibling enum definitions into the model docs,
      // exactly as the renderer's documentation / designer views do, so the
      // background validation sees the same design the user sees.
      const merged = mergeEnumDefinitionsIntoModels(doc, folder.enumDefinitions)
      let counter = 0
      const design = designFromDocumentation(folder.name, merged, () => `tmp-${counter++}`)
      // Enrich each issue with the CONCRETE identity of the faulty entity while
      // the (ephemeral) design is still in hand — the renderer never sees the
      // runtime ids, only the resolved label (+ route locator for a route).
      issues = validateApiDesign(design).map((issue) => {
        const subject = describeDesignIssue(design, issue)
        return {
          ...issue,
          ...(subject.label !== undefined ? { subjectLabel: subject.label } : {}),
          ...(subject.route !== undefined ? { route: subject.route } : {})
        }
      })
    } catch (error) {
      // The projection itself failed (a malformed documentation) — never block
      // the import / open, and keep it OUT of crash reporting (warn, not error).
      logger.warn('[ApiDesignValidationService] design validation pass failed', {
        folderId: folder.id,
        error: error instanceof Error ? error.message : String(error)
      })
      issues = []
    }
    this.setFolderIssues(folder.id, issues)
  }

  private setFolderIssues(folderId: string, issues: DesignIssueView[]): void {
    const prev = this.issuesByFolder.get(folderId)
    if (issues.length === 0) {
      if (prev === undefined) return
      this.issuesByFolder.delete(folderId)
    } else {
      if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(issues)) return
      this.issuesByFolder.set(folderId, issues)
    }
    this.broadcast(folderId, issues)
  }

  private broadcast(folderId: string, issues: DesignIssueView[]): void {
    const payload: FolderDesignIssues = { folderId, issues }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(FOLDER_DESIGN_ISSUES_CHANNEL, payload)
    }
  }

  private collectApiFolders(): EnvironmentFolder[] {
    const out: EnvironmentFolder[] = []
    const walk = (item: FolderItem): void => {
      if (isEnvironmentFolder(item) && item.apiDocumentation !== undefined) out.push(item)
      if (isAnyFolder(item)) {
        for (const child of item.items) walk(child)
      }
    }
    for (const collection of collectionStore.getCollections()) walk(collection)
    return out
  }
}

export const apiDesignValidationService = new ApiDesignValidationService()
