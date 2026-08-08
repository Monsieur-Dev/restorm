/**
 * Project-level MCP tools — open, create, save the .restorm file.
 *
 * Read tools alone aren't enough to drive restorm without the UI: an
 * AI client needs to be able to open an existing project file and to
 * create a new one. These tools wrap the existing `FileService` flow
 * (atomic write + open + UUID stamp + broadcast). Save uses the
 * renderer-driven autosave path because the canonical project state
 * lives in the renderer's React tree, not the main-side CollectionStore.
 */

import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { isAbsolute, dirname } from 'node:path'
import { McpService, getFileService, isFileServiceInitialized } from 'electron-core-ui/main'
import { BrowserWindow } from 'electron'
import { collectionStore } from '../../services/CollectionStore'
import { isEnvironmentFolder } from '../../../shared/types/folderTypes'
import { CURRENT_FILE_FORMAT_VERSION, FILE_FORMAT_VERSION_KEY } from '../../../shared/config/fileFormatVersion'

/**
 * Bounded wait for main's `CollectionStore` to actually reflect the
 * project `open_project` just opened, before replying. Without this, a
 * fast MCP write tool call immediately after `open_project` can race
 * ahead of the renderer→main mirror (`file:opened` → renderer populates
 * its tree → renderer mirrors it back over `collections:sync`, several
 * render/effect cycles + an IPC round trip later) and fail to find any
 * entity in the just-opened project.
 *
 * Polls `CollectionStore` directly against the file's OWN just-read
 * content, rather than reacting to a `collections:sync` event: that
 * event's payload is `rootItems.filter(isEnvironmentFolder)` (only
 * environment folders + their nested contents — see
 * `App.tsx`'s `environmentFolderCollections`), and the effect that fires
 * it runs unconditionally on every renderer mount, including the very
 * first one before any project is open. An event-based "wait for the
 * next sync" can resolve on that unrelated initial-mount sync instead of
 * the real one. Polling the store's actual content sidesteps that
 * entirely, and handles the empty-project case naturally: a file with no
 * environment folders has nothing to wait for, so it doesn't block at all.
 *
 * Bounded so `open_project` can NEVER hang: on timeout, reply anyway with
 * a `warning` field rather than block indefinitely.
 */
const OPEN_PROJECT_COLLECTIONS_READY_TIMEOUT_MS = 3_000
const OPEN_PROJECT_COLLECTIONS_READY_POLL_INTERVAL_MS = 50

/** The ids `CollectionStore` needs to contain for `filePath`'s content to
 * be considered "landed" — the top-level environment folders, since
 * that's the only thing the renderer's mirror-back actually syncs (see
 * the constant's doc comment above). A file with none of these has
 * nothing to wait for. */
export function expectedTopLevelEnvironmentFolderIds(content: unknown): string[] {
  const collections = (content as { collections?: unknown } | null)?.collections
  if (!Array.isArray(collections)) return []
  return collections.filter(isEnvironmentFolder).map((folder) => folder.id)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** Resolves `true` once every id in `expectedIds` is present in
 * `CollectionStore`, or `false` once `timeoutMs` elapses first —
 * this NEVER hangs. An empty `expectedIds` resolves `true` immediately
 * without polling at all. */
export async function waitForCollectionStoreReady(expectedIds: string[], timeoutMs: number): Promise<boolean> {
  if (expectedIds.length === 0) return true
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (expectedIds.every((id) => collectionStore.findById(id) !== null)) return true
    if (Date.now() >= deadline) return false
    await sleep(OPEN_PROJECT_COLLECTIONS_READY_POLL_INTERVAL_MS)
  }
}

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

export function registerProjectTools(mcp: McpService): void {
  mcp.registerTool(
    'list_recent_projects',
    {
      titleKey: 'mcpToolTitles.listRecentProjects',
      title: 'List recently opened projects',
      description:
        'List the recently opened .restorm projects (most recent first), so a client can discover what to open ' +
        'with `open_project`. Each entry: `{ path, name, lastOpened (epoch ms), isFavorite }`. Dead paths are pruned. ' +
        'Returns an empty list when none / before the FileService is ready.',
      inputSchema: {} as Record<string, unknown>
    },
    () => {
      if (!isFileServiceInitialized()) return jsonReply({ recent: [] })
      const recent = getFileService().getRecentFiles().map((f) => ({ path: f.path, name: f.name, lastOpened: f.lastOpened, isFavorite: f.isFavorite }))
      return jsonReply({ recent })
    }
  )

  mcp.registerTool(
    'create_project',
    {
      titleKey: 'mcpToolTitles.createProject',
      title: 'Create new project',
      description:
        'Create a new empty restorm project file at the given absolute path and open it. ' +
        'Writes a YAML single-file (default) with a fresh `_projectUuid`. Subsequent MCP write ' +
        'calls (`create_folder`, `import_from_url`, `create_request`, …) target this newly opened ' +
        'project. The renderer\'s `file:opened` listener picks up the broadcast and reloads its ' +
        'sidebar — the user sees the empty project appear immediately.',
      inputSchema: {
        filePath: z.string().min(1).describe(
          'Absolute path to the new .restorm file. The parent directory must already exist; the .restorm extension is added if missing. Fails if a file already exists at the path (it is never overwritten).'
        ),
        format: z.enum(['yaml', 'json', 'json5']).optional().describe(
          'Serialisation format. Default `yaml` (most readable).'
        )
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const rawPath = typeof argRecord['filePath'] === 'string' ? argRecord['filePath'] : ''
      if (!rawPath) return errorReply('filePath is required')
      const filePath = rawPath.endsWith('.restorm') ? rawPath : `${rawPath}.restorm`
      // Require an absolute path so the file lands where the caller expects,
      // not relative to the main process's (unspecified) cwd.
      if (!isAbsolute(filePath)) return errorReply(`filePath must be an absolute path: ${filePath}`)
      if (!isFileServiceInitialized()) return errorReply('FileService not initialised')
      // The parent directory must already exist as a directory — we create the
      // project file, not the tree above it.
      const parentDir = dirname(filePath)
      try {
        const parentStat = await fs.stat(parentDir)
        if (!parentStat.isDirectory()) return errorReply(`Parent path is not a directory: ${parentDir}`)
      } catch {
        return errorReply(`Parent directory does not exist: ${parentDir}`)
      }
      try {
        // A new document, declaring the format it is written in. The version
        // is not decoration: the compatibility gate reads it on open, and a
        // document that declares nothing is refused — so a project created
        // here has to state it or it could not be reopened.
        //
        // `FileService.open` stamps `_projectUuid` via `ensureFileUuid` so the
        // renderer's preferences key off it from the first `file:opened`.
        // `wx` creates the file atomically and FAILS if it already exists —
        // refusing to clobber an existing project and closing the
        // exists-check/write TOCTOU window in one move.
        const body = JSON.stringify({ [FILE_FORMAT_VERSION_KEY]: CURRENT_FILE_FORMAT_VERSION, collections: [] })
        await fs.writeFile(filePath, body, { encoding: 'utf8', flag: 'wx' })
        const result = await getFileService().open(filePath)
        if (!result.success) return errorReply(`FileService.open failed for ${filePath}`)
        return jsonReply({ filePath, opened: true })
      } catch (err) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EEXIST') {
          return errorReply(`A file already exists at ${filePath} — refusing to overwrite it. Choose a new path or open the existing project.`)
        }
        return errorReply(`create_project failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )

  mcp.registerTool(
    'open_project',
    {
      titleKey: 'mcpToolTitles.openProject',
      title: 'Open an existing project',
      description:
        'Open an existing .restorm file (single-file or folder-structure). Triggers the same ' +
        '`file:opened` flow as the File menu, so the renderer reloads the sidebar / workbench / ' +
        'recent-files. Errors out cleanly when the path doesn\'t exist or isn\'t a valid project. ' +
        'Waits briefly for the renderer to confirm the project is loaded before replying, so an ' +
        'immediate follow-up write tool call reliably finds the newly-opened entities; a `warning` ' +
        'field means that confirmation didn\'t arrive in time and a follow-up call may need a retry.',
      inputSchema: {
        filePath: z.string().min(1).describe('Absolute path to the .restorm file or folder to open.')
      } as Record<string, unknown>
    },
    async (args) => {
      const argRecord = args
      const filePath = typeof argRecord['filePath'] === 'string' ? argRecord['filePath'] : ''
      if (!filePath) return errorReply('filePath is required')
      if (!isFileServiceInitialized()) return errorReply('FileService not initialised')
      try {
        const result = await getFileService().open(filePath)
        if (!result.success) return errorReply(`FileService.open failed for ${filePath}`)
        const payload: Record<string, unknown> = { filePath, opened: true, isDirectory: result.isDirectory === true }
        const expectedIds = expectedTopLevelEnvironmentFolderIds(result.content)
        const ready = await waitForCollectionStoreReady(expectedIds, OPEN_PROJECT_COLLECTIONS_READY_TIMEOUT_MS)
        if (!ready) {
          payload['warning'] = `Project opened, but main's collection store wasn't confirmed synced within ${String(OPEN_PROJECT_COLLECTIONS_READY_TIMEOUT_MS)}ms — an immediate follow-up write tool call may not find newly-opened entities yet.`
        }
        return jsonReply(payload)
      } catch (err) {
        return errorReply(`open_project failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )

  mcp.registerTool(
    'save_project',
    {
      titleKey: 'mcpToolTitles.saveProject',
      title: 'Save the open project',
      description:
        'Trigger the autosave pipeline so any pending in-memory changes (from the MCP write tools, ' +
        'or any unsaved edits the user made) are persisted to disk. Save runs in the renderer ' +
        '(its React state is the source of truth); main fires the IPC and returns immediately.',
      inputSchema: {} as Record<string, unknown>
    },
    () => {
      broadcastSaveTrigger()
      return jsonReply({ triggered: true })
    }
  )
}
