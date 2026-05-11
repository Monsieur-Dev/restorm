/**
 * Read-only MCP tools — they let an MCP client (Claude Code, Cursor)
 * inspect the open project without mutating anything. Mutation happens
 * in OYO-213 / 214 (write + execution tools); navigation that focuses
 * the UI on a specific item happens in `./navigation.ts`.
 *
 * Tool registration runs through ECUI's `McpService.registerTool`;
 * tools are stored in a registry and re-instantiated on every HTTP
 * request (see ECUI docs/McpService/README.md "stateless transport").
 *
 * Secrets (PasswordValue) never leak: every Request / Folder /
 * Environment goes through `CollectionStore.serialize*` which respects
 * the `@NonSerialised` decorator + `toJSON` chain, so plaintext is
 * stripped one layer below the tool handler.
 */

import { z } from 'zod'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import { contextService } from '../../services/ContextService'
import { searchService } from 'electron-core-ui/main'
import {
  isAnyFolder,
  isEnvironmentFolder,
  isRequest
} from '../../../shared/models'
import { flattenTree, listChildren } from '../tree'

const MAX_SEARCH_RESULTS = 50
const ABS_MAX_SEARCH_RESULTS = 200

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Register all read tools on the passed McpService instance.
 * Idempotent across boot — but McpService throws on duplicate
 * registration, so don't call this twice in the same process.
 */
export function registerReadTools(mcp: McpService): void {
  mcp.registerTool(
    'list_folders',
    {
      title: 'List folders',
      description:
        'List folders in the open restorm project. With `parentId`, return the direct subfolders ' +
        'of that folder (or its env-folder children). Without `parentId`, return every folder in ' +
        'the project, each carrying its own `parentId` so the caller can rebuild the tree. ' +
        'Returns `[{ id, name, kind: "folder" | "env-folder", parentId }]`.',
      inputSchema: {
        parentId: z.string().min(1).optional().describe(
          'Folder id to list children of. Omit to list every folder in the project.'
        )
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const parentId = typeof argRecord['parentId'] === 'string' ? argRecord['parentId'] : undefined
      if (parentId === undefined) {
        return jsonReply(flattenTree(collectionStore.getCollections()).folders)
      }
      const target = collectionStore.findById(parentId)
      if (!target || !isAnyFolder(target)) {
        return errorReply(`No folder with id ${parentId} (target is ${target ? 'not a folder' : 'unknown'})`)
      }
      return jsonReply(listChildren(target).folders)
    }
  )

  mcp.registerTool(
    'list_requests',
    {
      title: 'List requests',
      description:
        'List requests in the open restorm project. With `folderId`, return the direct request ' +
        'children of that folder. Without `folderId`, return every request in the project. ' +
        'Returns `[{ id, name, protocol, method?, parentId }]`. Use `get_request(id)` to fetch ' +
        'the full request payload (URL, headers, body, …).',
      inputSchema: {
        folderId: z.string().min(1).optional().describe(
          'Folder id to list request children of. Omit to list every request in the project.'
        )
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const folderId = typeof argRecord['folderId'] === 'string' ? argRecord['folderId'] : undefined
      if (folderId === undefined) {
        return jsonReply(flattenTree(collectionStore.getCollections()).requests)
      }
      const target = collectionStore.findById(folderId)
      if (!target || !isAnyFolder(target)) {
        return errorReply(`No folder with id ${folderId} (target is ${target ? 'not a folder' : 'unknown'})`)
      }
      return jsonReply(listChildren(target).requests)
    }
  )

  mcp.registerTool(
    'get_request',
    {
      title: 'Get request',
      description:
        'Return the full typed JSON of a request: URL, method, headers, params, body, ' +
        'protocol-specific fields (GraphQL query, gRPC service, SOAP envelope, …). ' +
        'Secrets (`PasswordValue`) are masked — plaintext never leaves the main process.',
      inputSchema: {
        id: z.string().min(1).describe('Request id to fetch.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const id = typeof argRecord['id'] === 'string' ? argRecord['id'] : ''
      if (!id) return errorReply('id is required')
      const target = collectionStore.findById(id)
      if (!target || !isRequest(target)) {
        return errorReply(`No request with id ${id} (target is ${target ? 'not a request' : 'unknown'})`)
      }
      return jsonReply(collectionStore.serializeRequest(target))
    }
  )

  mcp.registerTool(
    'search',
    {
      title: 'Search project',
      description:
        'Run a typed search across folders / requests / environments using restorm\'s in-memory ' +
        'search index. Optional `kinds` filter narrows the result categories; `maxResults` caps ' +
        'the response length (default 50, max 200). Each match carries `{ id, title, category, ' +
        'description?, score }`; request-kind matches additionally carry `method` and `url` so ' +
        'callers can disambiguate hits (e.g. two requests named "List Users" on different paths) ' +
        'without a follow-up `get_request`.',
      inputSchema: {
        query: z.string().min(1).describe('Free-text query, e.g. "users" or "POST /pets".'),
        kinds: z.array(z.enum(['request', 'folder', 'environment', 'tag', 'settings'])).optional().describe(
          'Restrict matches to one or more categories. Omit for all kinds.'
        ),
        maxResults: z.coerce.number().int().min(1).max(ABS_MAX_SEARCH_RESULTS).optional().describe(
          `Maximum matches to return (default ${MAX_SEARCH_RESULTS}, hard cap ${ABS_MAX_SEARCH_RESULTS}).`
        )
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const query = typeof argRecord['query'] === 'string' ? argRecord['query'] : ''
      if (!query) return errorReply('query is required')
      const kinds = Array.isArray(argRecord['kinds'])
        ? new Set(argRecord['kinds'].filter((k): k is string => typeof k === 'string'))
        : null
      const rawMax = typeof argRecord['maxResults'] === 'number' ? argRecord['maxResults'] : MAX_SEARCH_RESULTS
      const max = Math.max(1, Math.min(ABS_MAX_SEARCH_RESULTS, Math.floor(rawMax)))
      const grouped = searchService.search(query)
      const matches: {
        id: string
        title: string
        category: string
        description?: string
        method?: string
        url?: string
        score: number
      }[] = []
      for (const group of grouped) {
        if (kinds !== null && !kinds.has(group.category)) continue
        for (const r of group.items) {
          if (matches.length >= max) break
          // For request-kind matches, fold in the on-disk method + URL
          // so the agent can preview the hit without an extra
          // `get_request`. Cheap O(1) lookup via the collection store.
          let methodVal: string | undefined
          let urlVal: string | undefined
          if (r.category === 'request') {
            const target = collectionStore.findById(r.id)
            if (target && isRequest(target)) {
              const req = target as { url?: string; method?: string; type?: string }
              urlVal = typeof req.url === 'string' ? req.url : undefined
              methodVal = typeof req.method === 'string' ? req.method : req.type
            }
          }
          matches.push({
            id: r.id,
            title: r.title,
            category: r.category,
            ...(r.description !== undefined ? { description: r.description } : {}),
            ...(methodVal !== undefined ? { method: methodVal } : {}),
            ...(urlVal !== undefined ? { url: urlVal } : {}),
            score: r.score
          })
        }
        if (matches.length >= max) break
      }
      return jsonReply({ query, matchCount: matches.length, truncated: matches.length === max, matches })
    }
  )

  mcp.registerTool(
    'get_active_env',
    {
      title: 'Get active environment',
      description:
        'Return the active environment for an env-folder along with its resolved Handlebars ' +
        'variables. The "active env" is what the renderer\'s env-selector currently has selected ' +
        'for that folder; if the renderer hasn\'t reported a selection yet, the first env in the ' +
        'folder is used as a fallback. Resolved variables come from `ContextService` and never ' +
        'contain plaintext secrets.',
      inputSchema: {
        envFolderId: z.string().min(1).describe('Env-folder id whose active environment to inspect.')
      } as Record<string, unknown>
    },
    (args) => {
      const argRecord = args
      const envFolderId = typeof argRecord['envFolderId'] === 'string' ? argRecord['envFolderId'] : ''
      if (!envFolderId) return errorReply('envFolderId is required')
      const folder = collectionStore.findById(envFolderId)
      if (!folder || !isEnvironmentFolder(folder)) {
        return errorReply(`No env-folder with id ${envFolderId}`)
      }
      const envs = folder.environments
      const firstEnv = envs[0]
      if (firstEnv === undefined) {
        return jsonReply({ envFolderId, selectedEnvId: null, selectedEnvName: null, variables: [] })
      }
      // Renderer-tracked selection takes precedence; fallback = first env.
      // The activeStateCache module owns the renderer-selection map and
      // exposes a single getter so this tool stays decoupled from the
      // renderer-IPC plumbing.
      const selectedId = pickSelectedEnvId(envFolderId, envs.map((e) => e.id)) ?? firstEnv.id
      const selected = envs.find((e) => e.id === selectedId) ?? firstEnv
      const ctx = contextService.getContext(selected.id)
      const variables = ctx
        ? Object.entries(ctx.variables).map(([key, value]) => ({
          key,
          value: typeof value === 'string' ? value : String(value),
          resolved: typeof value === 'string' ? value : String(value)
        }))
        : selected.variables.map((kv) => ({
          key: kv.key,
          value: typeof kv.value === 'string' ? kv.value : String(kv.value),
          resolved: typeof kv.value === 'string' ? kv.value : String(kv.value)
        }))
      return jsonReply({
        envFolderId,
        selectedEnvId: selected.id,
        selectedEnvName: selected.name,
        variables
      })
    }
  )

  mcp.registerTool(
    'get_current_tab',
    {
      title: 'Get current tab',
      description:
        'Return the currently active workbench tab: `{ tabId, itemId, kind }`. `kind` is one of ' +
        '"request", "folder", "env-folder" — or `null` when no item is open (welcome screen, etc.). ' +
        'Driven by a renderer push: the renderer notifies main on every active-tab change so the ' +
        'value reads fresh without an IPC round-trip per call.',
      inputSchema: {} as Record<string, unknown>
    },
    () => jsonReply(getCurrentTabSnapshot())
  )
}

// ---------------------------------------------------------------------------
// Hooks back into the active-state cache. Imported here (not at the
// top of the file) to keep the IPC plumbing isolated and unit-testable.
// ---------------------------------------------------------------------------

import { getCurrentTabSnapshot, pickSelectedEnvId } from './activeState'
