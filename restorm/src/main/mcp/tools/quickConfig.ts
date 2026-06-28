/**
 * MCP tools for a request's quick-config saved configurations: list / add /
 * update / delete, plus a describe tool that tells the AI which config fields
 * each protocol accepts. The payload is validated by a protocol-aware field
 * check before any add/update is accepted (a GET HTTP request and an OData /
 * gRPC request accept different fields). Reads cover both storage targets;
 * writes target the project (.restorm) config — see `../quickConfig`.
 */

import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import { isRequest } from '../../../shared/models'
import { broadcastTreeReplace } from './import'
import type { Request } from '../../../shared/types/collections'
import { REQUEST_TYPES } from '../../../shared/models/types'
import {
  listConfigs, addConfig, updateConfig, deleteConfig, describeConfigSchema
} from '../quickConfig'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Broadcast the renderer-driven autosave so a project-target change persists to
 * the .restorm file (the settings backend persists itself via the store). */
function triggerSave(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('file:autosave-trigger')
  }
}

/** Resolve a request id to its live Request, or null if it isn't a request. */
function resolveRequest(requestId: string): Request | null {
  const item = collectionStore.findById(requestId)
  return item && isRequest(item) ? item : null
}

export function registerQuickConfigTools(mcp: McpService): void {
  mcp.registerTool(
    'list_quick_configs',
    {
      titleKey: 'mcpToolTitles.listQuickConfigs',
      title: "List a request's saved quick-config configurations",
      description:
        "Return the saved quick-config configurations of a request: each with `id`, `name`, " +
        "`storageTarget` ('project' = saved in the .restorm file, 'settings' = user-local), and " +
        "`fields` (the saved config payload). Settings-target configs are only returned when an " +
        "active project is known. Returns `{ requestId, configs: [...] }`.",
      inputSchema: {
        requestId: z.string().min(1).describe('Request id (from list_requests).')
      } as Record<string, unknown>
    },
    (args) => {
      const requestId = typeof args['requestId'] === 'string' ? args['requestId'] : ''
      if (!requestId) return errorReply('requestId is required')
      const request = resolveRequest(requestId)
      if (!request) return errorReply(`No request with id ${requestId}`)
      return jsonReply({ requestId, configs: listConfigs(request) })
    }
  )

  mcp.registerTool(
    'add_quick_config',
    {
      titleKey: 'mcpToolTitles.addQuickConfig',
      title: "Add a saved quick-config configuration to a request",
      description:
        "Save a named quick-config on a request, in the PROJECT config (the .restorm file, travels with " +
        "the project). `fields` is the config payload — it is validated against the request's protocol " +
        "(use describe_quick_config_schema to learn the accepted fields); fields foreign to the protocol " +
        "are rejected. Saving an existing name overwrites it. (User-settings configs are managed in the " +
        "app, not via MCP.) Returns the saved config.",
      inputSchema: {
        requestId: z.string().min(1).describe('Request id the config belongs to.'),
        name: z.string().min(1).describe('Config name (unique per request).'),
        fields: z.record(z.unknown()).describe('Config payload — request fields valid for the protocol.')
      } as Record<string, unknown>
    },
    (args) => {
      const requestId = typeof args['requestId'] === 'string' ? args['requestId'] : ''
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      const fields = (args['fields'] ?? {}) as Record<string, unknown>
      if (!requestId) return errorReply('requestId is required')
      const request = resolveRequest(requestId)
      if (!request) return errorReply(`No request with id ${requestId}`)
      const res = addConfig(request, name, fields)
      if (!res.ok) return errorReply(res.error)
      broadcastTreeReplace()
      triggerSave()
      return jsonReply(res.config)
    }
  )

  mcp.registerTool(
    'update_quick_config',
    {
      titleKey: 'mcpToolTitles.updateQuickConfig',
      title: "Update a saved quick-config configuration",
      description:
        "Modify a saved quick-config by id (searched across both storage targets). Provide `fields` to " +
        "replace the payload (validated against the request's protocol) and/or `name` to rename. Returns " +
        "the updated config.",
      inputSchema: {
        requestId: z.string().min(1).describe('Request id the config belongs to.'),
        configId: z.string().min(1).describe('Id of the config to update (from list_quick_configs).'),
        fields: z.record(z.unknown()).optional().describe('New config payload (validated for the protocol).'),
        name: z.string().min(1).optional().describe('New config name.')
      } as Record<string, unknown>
    },
    (args) => {
      const requestId = typeof args['requestId'] === 'string' ? args['requestId'] : ''
      const configId = typeof args['configId'] === 'string' ? args['configId'] : ''
      if (!requestId) return errorReply('requestId is required')
      if (!configId) return errorReply('configId is required')
      const request = resolveRequest(requestId)
      if (!request) return errorReply(`No request with id ${requestId}`)
      const patch: { fields?: Record<string, unknown>; name?: string } = {}
      if (args['fields'] !== undefined && typeof args['fields'] === 'object' && args['fields'] !== null) {
        patch.fields = args['fields'] as Record<string, unknown>
      }
      if (typeof args['name'] === 'string') patch.name = args['name']
      const res = updateConfig(request, configId, patch)
      if (!res.ok) return errorReply(res.error)
      broadcastTreeReplace()
      triggerSave()
      return jsonReply(res.config)
    }
  )

  mcp.registerTool(
    'delete_quick_config',
    {
      titleKey: 'mcpToolTitles.deleteQuickConfig',
      title: "Delete a saved quick-config configuration",
      description:
        "Delete a saved quick-config by id (searched across both storage targets). Returns " +
        "`{ deleted: true }`.",
      inputSchema: {
        requestId: z.string().min(1).describe('Request id the config belongs to.'),
        configId: z.string().min(1).describe('Id of the config to delete (from list_quick_configs).')
      } as Record<string, unknown>
    },
    (args) => {
      const requestId = typeof args['requestId'] === 'string' ? args['requestId'] : ''
      const configId = typeof args['configId'] === 'string' ? args['configId'] : ''
      if (!requestId) return errorReply('requestId is required')
      if (!configId) return errorReply('configId is required')
      const request = resolveRequest(requestId)
      if (!request) return errorReply(`No request with id ${requestId}`)
      const res = deleteConfig(request, configId)
      if (!res.ok) return errorReply(res.error)
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({ deleted: true })
    }
  )

  mcp.registerTool(
    'describe_quick_config_schema',
    {
      titleKey: 'mcpToolTitles.describeQuickConfigSchema',
      title: "Describe the accepted quick-config fields per protocol",
      description:
        "Return the config fields a quick-config payload may carry, per protocol (http / graphql / grpc " +
        "/ soap / websocket / odata / auth). Pass `protocol` for one, or omit for all. Use this before " +
        "add_quick_config / update_quick_config to build a payload the protocol accepts.",
      inputSchema: {
        protocol: z.enum(REQUEST_TYPES).optional().describe('Restrict to one protocol; omit for all.')
      } as Record<string, unknown>
    },
    (args) => {
      const protocol = typeof args['protocol'] === 'string' && (REQUEST_TYPES as readonly string[]).includes(args['protocol'])
        ? (args['protocol'] as typeof REQUEST_TYPES[number])
        : undefined
      return jsonReply({ schema: describeConfigSchema(protocol) })
    }
  )
}
