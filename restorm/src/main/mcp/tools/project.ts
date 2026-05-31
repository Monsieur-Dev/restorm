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
import { McpService, getFileService, isFileServiceInitialized } from 'electron-core-ui/main'
import { BrowserWindow } from 'electron'

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
      title: 'Create new project',
      description:
        'Create a new empty restorm project file at the given absolute path and open it. ' +
        'Writes a YAML single-file (default) with a fresh `_projectUuid`. Subsequent MCP write ' +
        'calls (`create_folder`, `import_from_url`, `create_request`, …) target this newly opened ' +
        'project. The renderer\'s `file:opened` listener picks up the broadcast and reloads its ' +
        'sidebar — the user sees the empty project appear immediately.',
      inputSchema: {
        filePath: z.string().min(1).describe(
          'Absolute path to the new .restorm file. Parent directory must exist; the .restorm extension is added if missing.'
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
      if (!isFileServiceInitialized()) return errorReply('FileService not initialised')
      try {
        // Empty document body. FileService.open will stamp `_projectUuid`
        // for us via `ensureFileUuid` so the renderer's preferences key
        // off it from the very first `file:opened` broadcast.
        await fs.writeFile(filePath, '{}', 'utf8')
        const result = await getFileService().open(filePath)
        if (!result.success) return errorReply(`FileService.open failed for ${filePath}`)
        return jsonReply({ filePath, opened: true })
      } catch (err) {
        return errorReply(`create_project failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )

  mcp.registerTool(
    'open_project',
    {
      title: 'Open an existing project',
      description:
        'Open an existing .restorm file (single-file or folder-structure). Triggers the same ' +
        '`file:opened` flow as the File menu, so the renderer reloads the sidebar / workbench / ' +
        'recent-files. Errors out cleanly when the path doesn\'t exist or isn\'t a valid project.',
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
        return jsonReply({ filePath, opened: true, isDirectory: result.isDirectory === true })
      } catch (err) {
        return errorReply(`open_project failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  )

  mcp.registerTool(
    'save_project',
    {
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
