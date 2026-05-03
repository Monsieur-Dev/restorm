/**
 * MCP resource registrations for restorm. Resources are the
 * read-once-at-the-top primitive of MCP — clients can pull a snapshot
 * of project state without learning the tool surface. We expose four:
 *
 *   - `restorm://project`         — open project metadata
 *   - `restorm://tree`            — full hierarchical id+name tree
 *   - `restorm://active-tab`      — mirrors `get_current_tab`
 *   - `restorm://request/{id}`    — full request JSON, same as `get_request`
 *
 * All payloads are JSON text. The `request/{id}` template extracts the
 * id from the URL pathname so the SDK's resource template machinery
 * matches `restorm://request/abc-123`. Secrets stripping happens via
 * `CollectionStore.serializeRequest`, same path the `get_request` tool
 * uses — there's no second serialiser to keep in sync.
 */

import { McpService } from 'electron-core-ui'
import { collectionStore } from '../services/CollectionStore'
import { getFileService } from 'electron-core-ui/main'
import { isRequest } from '../../shared/models'
import { buildTree } from './tree'
import { getCurrentTabSnapshot } from './tools/activeState'

function jsonText(value: unknown): { text: string; mimeType: string } {
  return { text: JSON.stringify(value, null, 2), mimeType: 'application/json' }
}

export function registerResources(mcp: McpService): void {
  mcp.registerResource(
    'project',
    'restorm://project',
    {
      title: 'Project summary',
      description: 'Open project metadata: file path, name, format version, dirty flag.',
      mimeType: 'application/json'
    },
    () => {
      const fileService = getFileService()
      const state = fileService.getState()
      const collections = collectionStore.getCollections()
      const fileFormatVersion = collections[0]?.fileFormatVersion ?? null
      return jsonText({
        path: state.currentFile.path ?? null,
        name: state.currentFile.name ?? null,
        isDirty: state.currentFile.isDirty,
        fileFormatVersion,
        collectionCount: collections.length
      })
    }
  )

  mcp.registerResource(
    'tree',
    'restorm://tree',
    {
      title: 'Project tree',
      description:
        'Full hierarchical id + name tree of every folder, env-folder and request in the project. ' +
        'Request leaves carry their `protocol` so the client can decide whether to fetch the full ' +
        'payload via `get_request` / `restorm://request/{id}`.',
      mimeType: 'application/json'
    },
    () => jsonText(buildTree(collectionStore.getCollections()))
  )

  mcp.registerResource(
    'active-tab',
    'restorm://active-tab',
    {
      title: 'Active workbench tab',
      description: 'Snapshot of the currently focused workbench tab — mirrors the `get_current_tab` tool.',
      mimeType: 'application/json'
    },
    () => jsonText(getCurrentTabSnapshot())
  )

  mcp.registerResource(
    'request',
    'restorm://request/{id}',
    {
      title: 'Single request payload',
      description:
        'Full typed JSON of a request, same shape as `get_request(id)`. Pull via ' +
        '`restorm://request/<request-id>`. Secrets are masked; plaintext stays in main.',
      mimeType: 'application/json'
    },
    (uri) => {
      // The MCP SDK URL parser hands us the full URI; pull the id from
      // the pathname (`//request/<id>`). `URL` reuses the host slot
      // for the segment after the scheme://, so `id` lives at
      // `pathname.replace(/^\//, '')` after we strip the leading slash.
      const segments = uri.pathname.split('/').filter(Boolean)
      const id = segments[segments.length - 1] ?? ''
      if (!id) return jsonText({ error: 'request id missing from URI' })
      const target = collectionStore.findById(id)
      if (!target || !isRequest(target)) {
        return jsonText({ error: `No request with id ${id}` })
      }
      return jsonText(collectionStore.serializeRequest(target))
    }
  )
}
