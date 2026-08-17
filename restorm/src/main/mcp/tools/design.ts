/**
 * MCP tools — API designs. The differentiator: an agent designs a whole
 * API (models, enums, routes, examples), runs the generators, serves it
 * and exports its descriptor — without touching the UI.
 *
 * Conventions:
 * - Entities resolve by ID or by NAME (agents think in names; names are
 *   unique per kind by validation, and an ambiguous or unknown ref is a
 *   loud error).
 * - Mutations reassign top-level sections on the LIVE `ApiDesign`
 *   instance (the renderer's `assignDesignSection` convention), then
 *   `writeDesign` bumps the model version at the instant of mutation
 *   (the anti-clobber stamp), broadcasts the tree, triggers the
 *   autosave and hot-pushes the design to a running design server.
 * - Replies are JSON-as-text like every other tool family.
 */

import { z } from 'zod'
import { McpService } from 'electron-core-ui'
import { collectionStore } from '../../services/CollectionStore'
import { designServerService } from '../../services/DesignServerService'
import { designCodegenService, type TemplateSourceRef } from '../../services/designCodegen/DesignCodegenService'
import { getFileService, isFileServiceInitialized } from 'electron-core-ui'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { isApiDesign, isEnvironmentFolder, ApiDesign } from '../../../shared/models'
import type {
  DesignAuthKind,
  DesignEnum,
  DesignExample,
  DesignModel,
  DesignProperty,
  DesignProtocol,
  DesignRoute,
  DesignRouteGroup
} from '../../../shared/types/apiDesign'
import { validateApiDesign } from '../../../shared/design/validateApiDesign'
import { designFromDocumentation } from '../../../shared/design/designFromDocumentation'
import { generateCrud, generateSearchParams, syncPathParams } from '../../../shared/design/designRoutes'
import { removeModelFromDesign } from '../../../shared/design/designUsages'
import { DESCRIPTOR_FORMATS } from '../../../shared/design/descriptorFormats'
import { broadcastTreeReplace } from './import'
import { BrowserWindow } from 'electron'

function jsonReply(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** Nudge the renderer's autosave after a mutation (house pattern —
 * each tool file carries its own copy). */
function triggerSave(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('file:autosave-trigger')
  }
}

function errorReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true }
}

const AUTH_KINDS: readonly DesignAuthKind[] = ['none', 'bearer', 'apiKeyHeader', 'basic']

function findDesign(id: string): ApiDesign | null {
  const item = collectionStore.findById(id)
  return item !== null && isApiDesign(item) ? item : null
}

/** Resolve a design entity by id or unique name. */
function resolveEntity<T extends { id: string }>(
  entities: T[],
  ref: string,
  nameOf: (entity: T) => string,
  kind: string
): T | { error: string } {
  const byId = entities.find((entity) => entity.id === ref)
  if (byId !== undefined) return byId
  const byName = entities.filter((entity) => nameOf(entity) === ref)
  const only = byName[0]
  if (byName.length === 1 && only !== undefined) return only
  if (byName.length > 1) return { error: `${kind} name "${ref}" is ambiguous — use the id` }
  return { error: `No ${kind} with id or name "${ref}"` }
}

function isResolveError(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value
}

/**
 * Commit a mutated design: tree broadcast (which stamps the model
 * version at the instant of mutation — the anti-clobber contract),
 * the autosave nudge, then the hot push to a running design server so
 * the served behaviour matches the renderer's.
 */
function writeDesign(design: ApiDesign): void {
  // The tools mutate the store's object in place — announce the edit on
  // the design event bus (search index, save-unit bridge) exactly like
  // the UI's autosave path does, THEN rebroadcast the tree.
  collectionStore.notifyDesignUpdated(design)
  broadcastTreeReplace()
  triggerSave()
  if (designServerService.isListening(design.id)) {
    designServerService.updateDesign(design.toPlainObject() as unknown as ApiDesign)
  }
}

/** Resolve an output folder: absolute as-is, relative against the
 * project file's directory (null when no project is open). */
function resolveCodegenOutputRoot(outputDir: string): string | null {
  if (isAbsolute(outputDir)) return outputDir
  const projectPath = isFileServiceInitialized() ? getFileService().getFilePath() : null
  if (projectPath === null || projectPath === '') return null
  return resolvePath(dirname(projectPath), outputDir)
}

/** The summary a design projects into list/read replies. */
function designSummary(design: ApiDesign): Record<string, unknown> {
  const issues = validateApiDesign(design)
  return {
    id: design.id,
    name: design.name,
    title: design.info.title,
    ...(design.info.version !== undefined ? { version: design.info.version } : {}),
    models: design.models.length,
    enums: design.enums.length,
    routes: design.routeGroups.reduce((n, group) => n + group.routes.length, 0),
    issueCount: issues.length,
    serving: designServerService.isListening(design.id)
  }
}

function collectDesigns(): ApiDesign[] {
  const designs: ApiDesign[] = []
  const walk = (items: unknown[]): void => {
    for (const item of items) {
      if (item !== null && typeof item === 'object' && isApiDesign(item as never)) {
        designs.push(item as ApiDesign)
      } else if (item !== null && typeof item === 'object' && 'items' in (item as Record<string, unknown>)) {
        walk(((item as { items?: unknown[] }).items ?? []))
      }
    }
  }
  walk(collectionStore.getCollections() as unknown[])
  return designs
}

const newId = (): string => crypto.randomUUID()

export function registerDesignTools(mcp: McpService): void {
  // ── Read ──────────────────────────────────────────────────────────

  mcp.registerTool(
    'list_designs',
    {
      titleKey: 'mcpToolTitles.listDesigns',
      title: 'List API designs',
      description: 'List every API design of the open project with entity counts, validation issue count and serving state.',
      inputSchema: {} as Record<string, unknown>
    },
    () => jsonReply({ designs: collectDesigns().map(designSummary) })
  )

  mcp.registerTool(
    'get_design',
    {
      titleKey: 'mcpToolTitles.getDesign',
      title: 'Get an API design',
      description:
        'Full structure of one design — settings, models (properties, examples), enums, route groups and routes, ' +
        'plus its validation issues (stable codes + entity id paths). Reference by design id.',
      inputSchema: { designId: z.string().min(1).describe('Design id (from list_designs).') } as Record<string, unknown>
    },
    (args) => {
      const designId = typeof args['designId'] === 'string' ? args['designId'] : ''
      const design = findDesign(designId)
      if (!design) return errorReply(`No design with id ${designId}`)
      return jsonReply({ ...design.toPlainObject(), issues: validateApiDesign(design) })
    }
  )

  // ── Design CRUD ───────────────────────────────────────────────────

  mcp.registerTool(
    'create_design',
    {
      titleKey: 'mcpToolTitles.createDesign',
      title: 'Create an API design',
      description:
        'Create a blank API design at the project root or under `parentId` (any container). ' +
        'Returns the design summary; build it up with the model/enum/route tools.',
      inputSchema: {
        name: z.string().min(1).describe('Design name (also the sidebar label).'),
        title: z.string().optional().describe('API title (defaults to the name).'),
        parentId: z.string().optional().describe('Container id; omit for the project root.'),
        basePath: z.string().optional().describe('API base path, e.g. /api/v1.'),
        port: z.number().int().optional().describe('Design-server port (default 4820).')
      } as Record<string, unknown>
    },
    (args) => {
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (!name) return errorReply('name is required')
      const parentId = typeof args['parentId'] === 'string' ? args['parentId'] : null
      if (parentId !== null && collectionStore.findById(parentId) === null) {
        return errorReply(`No container with id ${parentId}`)
      }
      const basePath = typeof args['basePath'] === 'string' ? args['basePath'] : undefined
      const port = typeof args['port'] === 'number' ? args['port'] : undefined
      const design = collectionStore.createDesign(parentId, {
        name,
        info: { title: typeof args['title'] === 'string' ? args['title'] : name },
        ...(basePath !== undefined ? { server: { basePath } } : {}),
        ...(port !== undefined ? { serving: { port } } : {}),
        models: [],
        enums: [],
        routeGroups: []
      })
      broadcastTreeReplace()
      triggerSave()
      return jsonReply(designSummary(design))
    }
  )

  mcp.registerTool(
    'create_design_from_documentation',
    {
      titleKey: 'mcpToolTitles.createDesignFromDocumentation',
      title: 'Create a design from an imported API',
      description:
        'Derive a pre-filled design from an env folder\'s imported API documentation (models, enums, routes, auth) — ' +
        'the same path as the folder\'s "Create a design from this API" menu. The design lands inside the folder.',
      inputSchema: {
        envFolderId: z.string().min(1).describe('Env folder id carrying apiDocumentation.'),
        name: z.string().optional().describe('Design name (defaults to the API title).')
      } as Record<string, unknown>
    },
    (args) => {
      const envFolderId = typeof args['envFolderId'] === 'string' ? args['envFolderId'] : ''
      const folder = collectionStore.findById(envFolderId)
      if (!folder || !isEnvironmentFolder(folder)) return errorReply(`No env folder with id ${envFolderId}`)
      const doc = folder.apiDocumentation
      if (doc === undefined) return errorReply(`Env folder ${envFolderId} carries no API documentation`)
      const name = typeof args['name'] === 'string' && args['name'] !== '' ? args['name'] : doc.api.title
      const built = designFromDocumentation(name, doc, newId)
      const design = collectionStore.createDesign(envFolderId, built)
      broadcastTreeReplace()
      triggerSave()
      return jsonReply(designSummary(design))
    }
  )

  mcp.registerTool(
    'update_design',
    {
      titleKey: 'mcpToolTitles.updateDesign',
      title: 'Update a design\'s settings',
      description: 'Update the design-level settings: name, API title/version/description, base path, default auth, server port/latency, served protocol projections.',
      inputSchema: {
        designId: z.string().min(1).describe('Design id.'),
        name: z.string().optional(),
        title: z.string().optional(),
        version: z.string().optional(),
        description: z.string().optional(),
        basePath: z.string().optional().describe('Empty string clears it.'),
        defaultAuth: z.enum(['none', 'bearer', 'apiKeyHeader', 'basic']).optional(),
        port: z.number().int().optional(),
        latencyMs: z.number().int().optional(),
        protocols: z.array(z.enum(['graphql', 'soap', 'odata'])).optional()
          .describe('Extra protocol projections served alongside HTTP (replaces the list; empty array = HTTP only).')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      if (typeof args['name'] === 'string' && args['name'] !== '') design.name = args['name']
      const info = { ...design.info }
      if (typeof args['title'] === 'string' && args['title'] !== '') info.title = args['title']
      if (typeof args['version'] === 'string') {
        if (args['version'] === '') delete info.version
        else info.version = args['version']
      }
      if (typeof args['description'] === 'string') {
        if (args['description'] === '') delete info.description
        else info.description = args['description']
      }
      design.info = info
      if (typeof args['basePath'] === 'string') {
        const server = { ...(design.server ?? {}) }
        if (args['basePath'] === '') delete server.basePath
        else server.basePath = args['basePath']
        design.server = server
      }
      if (typeof args['defaultAuth'] === 'string' && (AUTH_KINDS as readonly string[]).includes(args['defaultAuth'])) {
        design.defaultAuth = args['defaultAuth'] as DesignAuthKind
      }
      if (typeof args['port'] === 'number' || typeof args['latencyMs'] === 'number') {
        const serving = { ...(design.serving ?? {}) }
        if (typeof args['port'] === 'number') serving.port = args['port']
        if (typeof args['latencyMs'] === 'number') {
          if (args['latencyMs'] === 0) delete serving.latencyMs
          else serving.latencyMs = args['latencyMs']
        }
        design.serving = serving
      }
      if (Array.isArray(args['protocols'])) {
        const extras = args['protocols'].filter(
          (p): p is Exclude<DesignProtocol, 'http'> => p === 'graphql' || p === 'soap' || p === 'odata'
        )
        const serving = { ...(design.serving ?? {}) }
        if (extras.length === 0) delete serving.protocols
        else serving.protocols = extras
        design.serving = serving
      }
      writeDesign(design)
      return jsonReply(designSummary(design))
    }
  )

  mcp.registerTool(
    'delete_design',
    {
      titleKey: 'mcpToolTitles.deleteDesign',
      title: 'Delete a design',
      description: 'Delete a design (stops its design server first). No confirmation prompt.',
      inputSchema: { designId: z.string().min(1).describe('Design id.') } as Record<string, unknown>
    },
    (args) => {
      const designId = typeof args['designId'] === 'string' ? args['designId'] : ''
      if (findDesign(designId) === null) return errorReply(`No design with id ${designId}`)
      designServerService.stop(designId)
      const ok = collectionStore.deleteDesign(designId)
      if (!ok) return errorReply(`deleteDesign failed for ${designId}`)
      broadcastTreeReplace()
      triggerSave()
      return jsonReply({ id: designId, deleted: true })
    }
  )

  // ── Models ────────────────────────────────────────────────────────

  mcp.registerTool(
    'create_design_model',
    {
      titleKey: 'mcpToolTitles.createDesignModel',
      title: 'Create a design model',
      description: 'Add a model to a design. Properties are added with set_design_property.',
      inputSchema: {
        designId: z.string().min(1),
        name: z.string().min(1).describe('Model name (a spec component name — unique across models and enums).'),
        description: z.string().optional(),
        inheritsFrom: z.string().optional().describe('Parent model id or name.'),
        volumetry: z.enum(['hundreds', 'tenThousands', 'millions']).optional(),
        timestamps: z.boolean().optional(),
        softDelete: z.boolean().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (!name) return errorReply('name is required')
      let inheritsFrom: string | undefined
      if (typeof args['inheritsFrom'] === 'string' && args['inheritsFrom'] !== '') {
        const parent = resolveEntity(design.models, args['inheritsFrom'], (m) => m.doc.name, 'model')
        if (isResolveError(parent)) return errorReply(parent.error)
        inheritsFrom = parent.id
      }
      const model: DesignModel = {
        id: newId(),
        doc: { name, ...(typeof args['description'] === 'string' && args['description'] !== '' ? { description: args['description'] } : {}) },
        properties: [],
        ...(typeof args['volumetry'] === 'string' ? { intents: { volumetry: args['volumetry'] as 'hundreds' } } : {}),
        ...(inheritsFrom !== undefined || args['timestamps'] === true || args['softDelete'] === true
          ? {
              design: {
                ...(inheritsFrom !== undefined ? { inheritsFrom } : {}),
                ...(args['timestamps'] === true ? { timestamps: true } : {}),
                ...(args['softDelete'] === true ? { softDelete: true } : {})
              }
            }
          : {})
      }
      design.models = [...design.models, model]
      writeDesign(design)
      return jsonReply({ designId: design.id, modelId: model.id, name })
    }
  )

  mcp.registerTool(
    'update_design_model',
    {
      titleKey: 'mcpToolTitles.updateDesignModel',
      title: 'Update a design model',
      description: 'Update a model\'s settings: name, description, inheritance, identifier, volumetry, timestamps, soft delete.',
      inputSchema: {
        designId: z.string().min(1),
        model: z.string().min(1).describe('Model id or name.'),
        name: z.string().optional(),
        description: z.string().optional(),
        inheritsFrom: z.string().optional().describe('Parent model id or name; empty string detaches.'),
        identifierProperty: z.string().optional().describe('Property id or name serving as identifier.'),
        identifierStrategy: z.enum(['uuid', 'autoIncrement', 'custom']).optional(),
        volumetry: z.enum(['hundreds', 'tenThousands', 'millions']).optional(),
        timestamps: z.boolean().optional(),
        softDelete: z.boolean().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.models, typeof args['model'] === 'string' ? args['model'] : '', (m) => m.doc.name, 'model')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      const model = { ...resolved, doc: { ...resolved.doc }, design: { ...(resolved.design ?? {}) }, intents: { ...(resolved.intents ?? {}) } }
      if (typeof args['name'] === 'string' && args['name'] !== '') model.doc.name = args['name']
      if (typeof args['description'] === 'string') {
        if (args['description'] === '') delete model.doc.description
        else model.doc.description = args['description']
      }
      if (typeof args['inheritsFrom'] === 'string') {
        if (args['inheritsFrom'] === '') {
          delete model.design.inheritsFrom
        } else {
          const parent = resolveEntity(design.models.filter((m) => m.id !== resolved.id), args['inheritsFrom'], (m) => m.doc.name, 'model')
          if (isResolveError(parent)) return errorReply(parent.error)
          model.design.inheritsFrom = parent.id
        }
      }
      if (typeof args['identifierProperty'] === 'string' && args['identifierProperty'] !== '') {
        const property = resolveEntity(resolved.properties, args['identifierProperty'], (p) => p.doc.name, 'property')
        if (isResolveError(property)) return errorReply(property.error)
        const strategy = typeof args['identifierStrategy'] === 'string' ? args['identifierStrategy'] : 'uuid'
        model.design.identifier = { propertyId: property.id, strategy: strategy as 'uuid' }
      }
      if (typeof args['volumetry'] === 'string') model.intents.volumetry = args['volumetry'] as 'hundreds'
      if (typeof args['timestamps'] === 'boolean') {
        if (args['timestamps']) model.design.timestamps = true
        else delete model.design.timestamps
      }
      if (typeof args['softDelete'] === 'boolean') {
        if (args['softDelete']) model.design.softDelete = true
        else delete model.design.softDelete
      }
      const cleaned: DesignModel = { ...model }
      if (Object.keys(model.design).length === 0) delete cleaned.design
      if (Object.keys(model.intents).length === 0) delete cleaned.intents
      design.models = design.models.map((m) => (m.id === resolved.id ? cleaned : m))
      writeDesign(design)
      return jsonReply({ designId: design.id, modelId: resolved.id, name: cleaned.doc.name })
    }
  )

  mcp.registerTool(
    'delete_design_model',
    {
      titleKey: 'mcpToolTitles.deleteDesignModel',
      title: 'Delete a design model',
      description:
        'Delete a model with the same detachment the UI applies: route bodies/responses pointing at it empty out, ' +
        'inheritance links and property references to it are removed.',
      inputSchema: {
        designId: z.string().min(1),
        model: z.string().min(1).describe('Model id or name.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.models, typeof args['model'] === 'string' ? args['model'] : '', (m) => m.doc.name, 'model')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      const next = removeModelFromDesign(design, resolved.id)
      design.models = next.models
      design.routeGroups = next.routeGroups
      writeDesign(design)
      return jsonReply({ designId: design.id, modelId: resolved.id, deleted: true })
    }
  )

  // ── Properties ────────────────────────────────────────────────────

  mcp.registerTool(
    'set_design_property',
    {
      titleKey: 'mcpToolTitles.setDesignProperty',
      title: 'Create or update a model property',
      description:
        'Create-or-update a property BY NAME on a model. Covers type/format/flags/constraints, the enum or model ' +
        'reference (by name or id; isArray makes it an array-of), design flags (unique/searchable/immutable/writeOnly/pii) ' +
        'and the default value.',
      inputSchema: {
        designId: z.string().min(1),
        model: z.string().min(1).describe('Model id or name.'),
        name: z.string().min(1).describe('Property name (the create-or-update key).'),
        type: z.string().optional().describe('string|integer|number|boolean|array|map — or leave for references.'),
        format: z.string().optional().describe('e.g. uuid, email, date-time, int64. Empty clears.'),
        required: z.boolean().optional(),
        description: z.string().optional(),
        example: z.unknown().optional(),
        nullable: z.boolean().optional(),
        readOnly: z.boolean().optional(),
        deprecated: z.boolean().optional(),
        enumRef: z.string().optional().describe('Enum id or name this property is typed by. Empty clears the reference.'),
        modelRef: z.string().optional().describe('Model id or name this property references. Empty clears the reference.'),
        isArray: z.boolean().optional().describe('With enumRef/modelRef: array-of-reference.'),
        constraints: z.record(z.string(), z.unknown()).optional().describe('minLength/maxLength/minimum/maximum/pattern/multipleOf/uniqueItems.'),
        unique: z.boolean().optional(),
        searchable: z.boolean().optional(),
        immutable: z.boolean().optional(),
        writeOnly: z.boolean().optional(),
        pii: z.boolean().optional(),
        defaultValue: z.unknown().optional(),
        onDelete: z.enum(['cascade', 'restrict', 'setNull']).optional().describe('Delete rule of a model reference.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolvedModel = resolveEntity(design.models, typeof args['model'] === 'string' ? args['model'] : '', (m) => m.doc.name, 'model')
      if (isResolveError(resolvedModel)) return errorReply(resolvedModel.error)
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (!name) return errorReply('name is required')

      const existing = resolvedModel.properties.find((p) => p.doc.name === name)
      const property: DesignProperty = existing !== undefined
        ? { ...existing, doc: { ...existing.doc }, design: { ...(existing.design ?? {}) }, intents: { ...(existing.intents ?? {}) } }
        : { id: newId(), doc: { name, type: 'string', required: false }, design: {}, intents: {} }

      if (typeof args['type'] === 'string' && args['type'] !== '') property.doc.type = args['type']
      if (typeof args['format'] === 'string') {
        if (args['format'] === '') delete property.doc.format
        else property.doc.format = args['format']
      }
      if (typeof args['required'] === 'boolean') property.doc.required = args['required']
      if (typeof args['description'] === 'string') {
        if (args['description'] === '') delete property.doc.description
        else property.doc.description = args['description']
      }
      if (args['example'] !== undefined) property.doc.example = args['example']
      if (typeof args['nullable'] === 'boolean') {
        if (args['nullable']) property.doc.nullable = true
        else delete property.doc.nullable
      }
      if (typeof args['readOnly'] === 'boolean') {
        if (args['readOnly']) property.doc.readOnly = true
        else delete property.doc.readOnly
      }
      if (typeof args['deprecated'] === 'boolean') {
        if (args['deprecated']) property.doc.deprecated = true
        else delete property.doc.deprecated
      }
      if (args['constraints'] !== undefined && typeof args['constraints'] === 'object') {
        property.doc.constraints = args['constraints'] as never
      }

      const design_ = property.design ?? {}
      const isArray = args['isArray'] === true
      if (typeof args['enumRef'] === 'string') {
        if (args['enumRef'] === '') {
          delete design_.reference
        } else {
          const target = resolveEntity(design.enums, args['enumRef'], (e) => e.doc.name, 'enum')
          if (isResolveError(target)) return errorReply(target.error)
          design_.reference = { target: 'enum', refId: target.id }
          property.doc.targetModelRef = target.doc.name
          if (isArray) property.doc.isArrayOfRef = true
        }
      }
      if (typeof args['modelRef'] === 'string') {
        if (args['modelRef'] === '') {
          delete design_.reference
          delete property.doc.targetModelRef
          delete property.doc.isArrayOfRef
        } else {
          const target = resolveEntity(design.models, args['modelRef'], (m) => m.doc.name, 'model')
          if (isResolveError(target)) return errorReply(target.error)
          const onDelete = typeof args['onDelete'] === 'string' ? { onDelete: args['onDelete'] as 'cascade' } : {}
          design_.reference = { target: 'model', refId: target.id, ...onDelete }
          property.doc.targetModelRef = target.doc.name
          property.doc.type = isArray ? `array<${target.doc.name}>` : target.doc.name
          if (isArray) property.doc.isArrayOfRef = true
          else delete property.doc.isArrayOfRef
        }
      }
      if (typeof args['unique'] === 'boolean') {
        if (args['unique']) design_.unique = true
        else delete design_.unique
      }
      if (typeof args['searchable'] === 'boolean') {
        if (args['searchable']) design_.searchable = true
        else delete design_.searchable
      }
      if (typeof args['immutable'] === 'boolean') {
        if (args['immutable']) design_.immutable = true
        else delete design_.immutable
      }
      if (typeof args['writeOnly'] === 'boolean') {
        if (args['writeOnly']) design_.writeOnly = true
        else delete design_.writeOnly
      }
      if (args['defaultValue'] !== undefined) design_.defaultValue = args['defaultValue']
      const intents = property.intents ?? {}
      if (typeof args['pii'] === 'boolean') {
        if (args['pii']) intents.pii = true
        else delete intents.pii
      }

      const cleaned: DesignProperty = { id: property.id, doc: property.doc }
      if (Object.keys(design_).length > 0) cleaned.design = design_
      if (Object.keys(intents).length > 0) cleaned.intents = intents

      const properties = existing !== undefined
        ? resolvedModel.properties.map((p) => (p.id === property.id ? cleaned : p))
        : [...resolvedModel.properties, cleaned]
      design.models = design.models.map((m) => (m.id === resolvedModel.id ? { ...resolvedModel, properties } : m))
      writeDesign(design)
      return jsonReply({ designId: design.id, modelId: resolvedModel.id, propertyId: cleaned.id, name, created: existing === undefined })
    }
  )

  mcp.registerTool(
    'delete_design_property',
    {
      titleKey: 'mcpToolTitles.deleteDesignProperty',
      title: 'Delete a model property',
      description: 'Delete a property by name (or id) from a model.',
      inputSchema: {
        designId: z.string().min(1),
        model: z.string().min(1).describe('Model id or name.'),
        property: z.string().min(1).describe('Property id or name.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolvedModel = resolveEntity(design.models, typeof args['model'] === 'string' ? args['model'] : '', (m) => m.doc.name, 'model')
      if (isResolveError(resolvedModel)) return errorReply(resolvedModel.error)
      const property = resolveEntity(resolvedModel.properties, typeof args['property'] === 'string' ? args['property'] : '', (p) => p.doc.name, 'property')
      if (isResolveError(property)) return errorReply(property.error)
      design.models = design.models.map((m) =>
        m.id === resolvedModel.id ? { ...resolvedModel, properties: resolvedModel.properties.filter((p) => p.id !== property.id) } : m
      )
      writeDesign(design)
      return jsonReply({ designId: design.id, modelId: resolvedModel.id, propertyId: property.id, deleted: true })
    }
  )

  // ── Enums ─────────────────────────────────────────────────────────

  mcp.registerTool(
    'create_design_enum',
    {
      titleKey: 'mcpToolTitles.createDesignEnum',
      title: 'Create a design enum',
      description: 'Add an enum (name + values) to a design. Enums share the component namespace with models.',
      inputSchema: {
        designId: z.string().min(1),
        name: z.string().min(1),
        values: z.array(z.union([z.string(), z.number()])).min(1),
        description: z.string().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (!name) return errorReply('name is required')
      if (!Array.isArray(args['values']) || args['values'].length === 0) return errorReply('values must be a non-empty array')
      const entry: DesignEnum = {
        id: newId(),
        doc: {
          name,
          properties: [],
          enumValues: args['values'] as unknown[],
          ...(typeof args['description'] === 'string' && args['description'] !== '' ? { description: args['description'] } : {})
        }
      }
      design.enums = [...design.enums, entry]
      writeDesign(design)
      return jsonReply({ designId: design.id, enumId: entry.id, name })
    }
  )

  mcp.registerTool(
    'update_design_enum',
    {
      titleKey: 'mcpToolTitles.updateDesignEnum',
      title: 'Update a design enum',
      description: 'Update an enum\'s name, values or description (by id or name).',
      inputSchema: {
        designId: z.string().min(1),
        enum: z.string().min(1).describe('Enum id or name.'),
        name: z.string().optional(),
        values: z.array(z.union([z.string(), z.number()])).optional(),
        description: z.string().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.enums, typeof args['enum'] === 'string' ? args['enum'] : '', (e) => e.doc.name, 'enum')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      const doc = { ...resolved.doc }
      if (typeof args['name'] === 'string' && args['name'] !== '') doc.name = args['name']
      if (Array.isArray(args['values']) && args['values'].length > 0) doc.enumValues = args['values'] as unknown[]
      if (typeof args['description'] === 'string') {
        if (args['description'] === '') delete doc.description
        else doc.description = args['description']
      }
      design.enums = design.enums.map((e) => (e.id === resolved.id ? { ...resolved, doc } : e))
      writeDesign(design)
      return jsonReply({ designId: design.id, enumId: resolved.id, name: doc.name })
    }
  )

  mcp.registerTool(
    'delete_design_enum',
    {
      titleKey: 'mcpToolTitles.deleteDesignEnum',
      title: 'Delete a design enum',
      description: 'Delete an enum (by id or name). Properties referencing it keep their doc type but lose the link.',
      inputSchema: {
        designId: z.string().min(1),
        enum: z.string().min(1).describe('Enum id or name.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.enums, typeof args['enum'] === 'string' ? args['enum'] : '', (e) => e.doc.name, 'enum')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      design.enums = design.enums.filter((e) => e.id !== resolved.id)
      // Detach property references pointing at the removed enum.
      design.models = design.models.map((model) => ({
        ...model,
        properties: model.properties.map((property) => {
          const reference = property.design?.reference
          if (reference?.target !== 'enum' || reference.refId !== resolved.id) return property
          const { reference: _dropped, ...designRest } = property.design ?? {}
          const detached: DesignProperty = { ...property }
          if (Object.keys(designRest).length > 0) detached.design = designRest
          else delete detached.design
          return detached
        })
      }))
      writeDesign(design)
      return jsonReply({ designId: design.id, enumId: resolved.id, deleted: true })
    }
  )

  // ── Named examples ────────────────────────────────────────────────

  mcp.registerTool(
    'set_design_example',
    {
      titleKey: 'mcpToolTitles.setDesignExample',
      title: 'Create or update a named example',
      description:
        'Create-or-update a model\'s named example BY NAME. `values` maps property NAMES to values; unset properties ' +
        'serve seeded values. The design server serves named examples first.',
      inputSchema: {
        designId: z.string().min(1),
        model: z.string().min(1).describe('Model id or name.'),
        name: z.string().min(1).describe('Example name (the create-or-update key), e.g. "an admin User".'),
        values: z.record(z.string(), z.unknown()).describe('Property name → value.'),
        description: z.string().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolvedModel = resolveEntity(design.models, typeof args['model'] === 'string' ? args['model'] : '', (m) => m.doc.name, 'model')
      if (isResolveError(resolvedModel)) return errorReply(resolvedModel.error)
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (!name) return errorReply('name is required')
      const rawValues = (args['values'] ?? {}) as Record<string, unknown>
      // Example values key by property ID — translate the agent's names.
      const values: Record<string, unknown> = {}
      for (const [propertyName, value] of Object.entries(rawValues)) {
        const property = resolvedModel.properties.find((p) => p.doc.name === propertyName)
        if (property === undefined) return errorReply(`Model ${resolvedModel.doc.name} has no property "${propertyName}"`)
        values[property.id] = value
      }
      const examples = resolvedModel.examples ?? []
      const existing = examples.find((e) => e.name === name)
      const example: DesignExample = {
        id: existing?.id ?? newId(),
        name,
        values,
        ...(typeof args['description'] === 'string' && args['description'] !== '' ? { description: args['description'] } : {})
      }
      const nextExamples = existing !== undefined ? examples.map((e) => (e.id === example.id ? example : e)) : [...examples, example]
      design.models = design.models.map((m) => (m.id === resolvedModel.id ? { ...resolvedModel, examples: nextExamples } : m))
      writeDesign(design)
      return jsonReply({ designId: design.id, modelId: resolvedModel.id, exampleId: example.id, name, created: existing === undefined })
    }
  )

  mcp.registerTool(
    'delete_design_example',
    {
      titleKey: 'mcpToolTitles.deleteDesignExample',
      title: 'Delete a named example',
      description: 'Delete a model\'s named example by name (or id).',
      inputSchema: {
        designId: z.string().min(1),
        model: z.string().min(1).describe('Model id or name.'),
        example: z.string().min(1).describe('Example id or name.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolvedModel = resolveEntity(design.models, typeof args['model'] === 'string' ? args['model'] : '', (m) => m.doc.name, 'model')
      if (isResolveError(resolvedModel)) return errorReply(resolvedModel.error)
      const examples = resolvedModel.examples ?? []
      const example = resolveEntity(examples, typeof args['example'] === 'string' ? args['example'] : '', (e) => e.name, 'example')
      if (isResolveError(example)) return errorReply(example.error)
      design.models = design.models.map((m) =>
        m.id === resolvedModel.id ? { ...resolvedModel, examples: examples.filter((e) => e.id !== example.id) } : m
      )
      writeDesign(design)
      return jsonReply({ designId: design.id, modelId: resolvedModel.id, exampleId: example.id, deleted: true })
    }
  )

  // ── Route groups ──────────────────────────────────────────────────

  mcp.registerTool(
    'create_design_route_group',
    {
      titleKey: 'mcpToolTitles.createDesignRouteGroup',
      title: 'Create a route group',
      description: 'Add a route group (base path, version prefix, auth contract) to a design.',
      inputSchema: {
        designId: z.string().min(1),
        name: z.string().min(1).describe('Group name (a Swagger tag).'),
        basePath: z.string().optional().describe('Group base path, e.g. /users.'),
        versionPrefix: z.string().optional().describe('e.g. /v1.'),
        auth: z.enum(['none', 'bearer', 'apiKeyHeader', 'basic']).optional(),
        description: z.string().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const name = typeof args['name'] === 'string' ? args['name'] : ''
      if (!name) return errorReply('name is required')
      const meta: DesignRouteGroup['design'] = {
        ...(typeof args['basePath'] === 'string' && args['basePath'] !== '' ? { basePath: args['basePath'] } : {}),
        ...(typeof args['versionPrefix'] === 'string' && args['versionPrefix'] !== '' ? { versionPrefix: args['versionPrefix'] } : {}),
        ...(typeof args['auth'] === 'string' && (AUTH_KINDS as readonly string[]).includes(args['auth']) ? { auth: args['auth'] as DesignAuthKind } : {})
      }
      const group: DesignRouteGroup = {
        id: newId(),
        doc: { name, ...(typeof args['description'] === 'string' && args['description'] !== '' ? { description: args['description'] } : {}) },
        ...(Object.keys(meta).length > 0 ? { design: meta } : {}),
        routes: []
      }
      design.routeGroups = [...design.routeGroups, group]
      writeDesign(design)
      return jsonReply({ designId: design.id, groupId: group.id, name })
    }
  )

  mcp.registerTool(
    'update_design_route_group',
    {
      titleKey: 'mcpToolTitles.updateDesignRouteGroup',
      title: 'Update a route group',
      description: 'Update a group\'s name, description, base path, version prefix or auth (by id or name).',
      inputSchema: {
        designId: z.string().min(1),
        group: z.string().min(1).describe('Group id or name.'),
        name: z.string().optional(),
        description: z.string().optional(),
        basePath: z.string().optional().describe('Empty clears.'),
        versionPrefix: z.string().optional().describe('Empty clears.'),
        auth: z.enum(['none', 'bearer', 'apiKeyHeader', 'basic']).optional()
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.routeGroups, typeof args['group'] === 'string' ? args['group'] : '', (g) => g.doc.name, 'route group')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      const doc = { ...resolved.doc }
      if (typeof args['name'] === 'string' && args['name'] !== '') doc.name = args['name']
      if (typeof args['description'] === 'string') {
        if (args['description'] === '') delete doc.description
        else doc.description = args['description']
      }
      const meta = { ...(resolved.design ?? {}) }
      if (typeof args['basePath'] === 'string') {
        if (args['basePath'] === '') delete meta.basePath
        else meta.basePath = args['basePath']
      }
      if (typeof args['versionPrefix'] === 'string') {
        if (args['versionPrefix'] === '') delete meta.versionPrefix
        else meta.versionPrefix = args['versionPrefix']
      }
      if (typeof args['auth'] === 'string' && (AUTH_KINDS as readonly string[]).includes(args['auth'])) {
        meta.auth = args['auth'] as DesignAuthKind
      }
      const next: DesignRouteGroup = { ...resolved, doc }
      if (Object.keys(meta).length > 0) next.design = meta
      else delete next.design
      design.routeGroups = design.routeGroups.map((g) => (g.id === resolved.id ? next : g))
      writeDesign(design)
      return jsonReply({ designId: design.id, groupId: resolved.id, name: doc.name })
    }
  )

  mcp.registerTool(
    'delete_design_route_group',
    {
      titleKey: 'mcpToolTitles.deleteDesignRouteGroup',
      title: 'Delete a route group',
      description: 'Delete a route group and every route it carries (by id or name).',
      inputSchema: {
        designId: z.string().min(1),
        group: z.string().min(1).describe('Group id or name.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.routeGroups, typeof args['group'] === 'string' ? args['group'] : '', (g) => g.doc.name, 'route group')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      design.routeGroups = design.routeGroups.filter((g) => g.id !== resolved.id)
      writeDesign(design)
      return jsonReply({ designId: design.id, groupId: resolved.id, deleted: true })
    }
  )

  // ── Routes ────────────────────────────────────────────────────────

  mcp.registerTool(
    'create_design_route',
    {
      titleKey: 'mcpToolTitles.createDesignRoute',
      title: 'Create a design route',
      description:
        'Add a route to a group. `{{param}}` placeholders in the pattern auto-create path parameter rows ' +
        '(the editor\'s sync). A 200 response is seeded; shape it with update_design_route.',
      inputSchema: {
        designId: z.string().min(1),
        group: z.string().min(1).describe('Group id or name.'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
        urlPattern: z.string().min(1).describe('Path relative to the group, Restorm spelling: /{{id}}.'),
        summary: z.string().optional(),
        description: z.string().optional(),
        operationId: z.string().optional()
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.routeGroups, typeof args['group'] === 'string' ? args['group'] : '', (g) => g.doc.name, 'route group')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      const urlPattern = typeof args['urlPattern'] === 'string' ? args['urlPattern'] : '/'
      const bare: DesignRoute = {
        id: newId(),
        doc: {
          match: { urlPattern: '/', method: typeof args['method'] === 'string' ? args['method'] : 'GET' },
          responses: { '200': { description: 'OK' } },
          ...(typeof args['summary'] === 'string' && args['summary'] !== '' ? { summary: args['summary'] } : {}),
          ...(typeof args['description'] === 'string' && args['description'] !== '' ? { description: args['description'] } : {}),
          ...(typeof args['operationId'] === 'string' && args['operationId'] !== '' ? { operationId: args['operationId'] } : {})
        }
      }
      const route = syncPathParams(bare, urlPattern)
      design.routeGroups = design.routeGroups.map((g) => (g.id === resolved.id ? { ...resolved, routes: [...resolved.routes, route] } : g))
      writeDesign(design)
      return jsonReply({ designId: design.id, groupId: resolved.id, routeId: route.id })
    }
  )

  mcp.registerTool(
    'update_design_route',
    {
      titleKey: 'mcpToolTitles.updateDesignRoute',
      title: 'Update a design route',
      description:
        'Update a route (by id or summary): match, docs, per-code responses ({code: {modelRef?, list?, paginated?, exampleName?, description?}}), ' +
        'input body ({modelRef?, contentType?}), parameter links ({paramName: {modelRef, propertyRef, descriptionAuto?}}), ' +
        'and settings (cacheSeconds, idempotent, deprecated, authOverride, pagination).',
      inputSchema: {
        designId: z.string().min(1),
        route: z.string().min(1).describe('Route id or summary.'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
        urlPattern: z.string().optional().describe('Re-syncs {{param}} rows.'),
        summary: z.string().optional(),
        description: z.string().optional(),
        operationId: z.string().optional(),
        deprecated: z.boolean().optional(),
        responses: z.record(z.string(), z.unknown()).optional(),
        body: z.record(z.string(), z.unknown()).optional(),
        paramLinks: z.record(z.string(), z.unknown()).optional(),
        cacheSeconds: z.number().int().optional().describe('0 clears.'),
        idempotent: z.boolean().optional(),
        authOverride: z.enum(['none', 'bearer', 'apiKeyHeader', 'basic']).optional(),
        pagination: z.record(z.string(), z.unknown()).optional().describe('{style, defaultLimit, maxLimit}.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const located = findRoute(design, typeof args['route'] === 'string' ? args['route'] : '')
      if (isResolveError(located)) return errorReply(located.error)
      const { group, route } = located
      let next: DesignRoute = { ...route, doc: { ...route.doc, match: { ...route.doc.match } } }
      if (typeof args['method'] === 'string') next.doc.match.method = args['method']
      if (typeof args['urlPattern'] === 'string' && args['urlPattern'] !== '') next = syncPathParams(next, args['urlPattern'])
      if (typeof args['summary'] === 'string') {
        if (args['summary'] === '') delete next.doc.summary
        else next.doc.summary = args['summary']
      }
      if (typeof args['description'] === 'string') {
        if (args['description'] === '') delete next.doc.description
        else next.doc.description = args['description']
      }
      if (typeof args['operationId'] === 'string') {
        if (args['operationId'] === '') delete next.doc.operationId
        else next.doc.operationId = args['operationId']
      }
      if (typeof args['deprecated'] === 'boolean') {
        if (args['deprecated']) next.doc.deprecated = true
        else delete next.doc.deprecated
      }

      const meta = { ...(next.design ?? {}) }
      if (args['responses'] !== undefined && typeof args['responses'] === 'object') {
        const docResponses: NonNullable<DesignRoute['doc']['responses']> = {}
        const metaResponses: NonNullable<NonNullable<DesignRoute['design']>['responses']> = {}
        for (const [code, raw] of Object.entries(args['responses'] as Record<string, unknown>)) {
          const entry = (raw ?? {}) as Record<string, unknown>
          docResponses[code] = {
            ...(typeof entry['description'] === 'string' && entry['description'] !== '' ? { description: entry['description'] } : {})
          }
          const modelRef = entry['modelRef']
          if (typeof modelRef === 'string' && modelRef !== '') {
            const model = resolveEntity(design.models, modelRef, (m) => m.doc.name, 'model')
            if (isResolveError(model)) return errorReply(model.error)
            let exampleId: string | undefined
            if (typeof entry['exampleName'] === 'string' && entry['exampleName'] !== '') {
              const example = resolveEntity(model.examples ?? [], entry['exampleName'], (e) => e.name, 'example')
              if (isResolveError(example)) return errorReply(example.error)
              exampleId = example.id
            }
            metaResponses[code] = {
              modelId: model.id,
              ...(entry['list'] === true ? { list: true } : {}),
              ...(entry['paginated'] === true ? { paginated: true } : {}),
              ...(exampleId !== undefined ? { exampleId } : {})
            }
          }
        }
        next.doc.responses = docResponses
        if (Object.keys(metaResponses).length > 0) meta.responses = metaResponses
        else delete meta.responses
      }
      if (args['body'] !== undefined && typeof args['body'] === 'object') {
        const entry = args['body'] as Record<string, unknown>
        if (Object.keys(entry).length === 0) {
          delete meta.body
        } else {
          let modelId: string | undefined
          if (typeof entry['modelRef'] === 'string' && entry['modelRef'] !== '') {
            const model = resolveEntity(design.models, entry['modelRef'], (m) => m.doc.name, 'model')
            if (isResolveError(model)) return errorReply(model.error)
            modelId = model.id
          }
          meta.body = {
            ...(modelId !== undefined ? { modelId } : {}),
            contentType: typeof entry['contentType'] === 'string' && entry['contentType'] !== '' ? entry['contentType'] : 'application/json'
          }
        }
      }
      if (args['paramLinks'] !== undefined && typeof args['paramLinks'] === 'object') {
        const links: NonNullable<NonNullable<DesignRoute['design']>['paramLinks']> = {}
        for (const [paramName, raw] of Object.entries(args['paramLinks'] as Record<string, unknown>)) {
          const entry = (raw ?? {}) as Record<string, unknown>
          const model = resolveEntity(design.models, typeof entry['modelRef'] === 'string' ? entry['modelRef'] : '', (m) => m.doc.name, 'model')
          if (isResolveError(model)) return errorReply(model.error)
          const property = resolveEntity(model.properties, typeof entry['propertyRef'] === 'string' ? entry['propertyRef'] : '', (p) => p.doc.name, 'property')
          if (isResolveError(property)) return errorReply(property.error)
          links[paramName] = {
            modelId: model.id,
            propertyId: property.id,
            ...(entry['descriptionAuto'] === true ? { descriptionAuto: true } : {})
          }
        }
        if (Object.keys(links).length > 0) meta.paramLinks = links
        else delete meta.paramLinks
      }
      if (typeof args['cacheSeconds'] === 'number') {
        if (args['cacheSeconds'] <= 0) delete meta.cacheSeconds
        else meta.cacheSeconds = args['cacheSeconds']
      }
      if (typeof args['idempotent'] === 'boolean') {
        if (args['idempotent']) meta.idempotent = true
        else delete meta.idempotent
      }
      if (typeof args['authOverride'] === 'string' && (AUTH_KINDS as readonly string[]).includes(args['authOverride'])) {
        meta.authOverride = args['authOverride'] as DesignAuthKind
      }
      if (args['pagination'] !== undefined && typeof args['pagination'] === 'object') {
        const entry = args['pagination'] as Record<string, unknown>
        if (Object.keys(entry).length === 0) delete meta.pagination
        else {
          meta.pagination = {
            style: typeof entry['style'] === 'string' ? (entry['style'] as 'offset') : 'offset',
            ...(typeof entry['defaultLimit'] === 'number' ? { defaultLimit: entry['defaultLimit'] } : {}),
            ...(typeof entry['maxLimit'] === 'number' ? { maxLimit: entry['maxLimit'] } : {})
          }
        }
      }
      if (Object.keys(meta).length > 0) next.design = meta
      else delete next.design

      design.routeGroups = design.routeGroups.map((g) =>
        g.id === group.id ? { ...group, routes: group.routes.map((r) => (r.id === route.id ? next : r)) } : g
      )
      writeDesign(design)
      return jsonReply({ designId: design.id, groupId: group.id, routeId: route.id })
    }
  )

  mcp.registerTool(
    'delete_design_route',
    {
      titleKey: 'mcpToolTitles.deleteDesignRoute',
      title: 'Delete a design route',
      description: 'Delete a route (by id or summary).',
      inputSchema: {
        designId: z.string().min(1),
        route: z.string().min(1).describe('Route id or summary.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const located = findRoute(design, typeof args['route'] === 'string' ? args['route'] : '')
      if (isResolveError(located)) return errorReply(located.error)
      design.routeGroups = design.routeGroups.map((g) =>
        g.id === located.group.id ? { ...located.group, routes: located.group.routes.filter((r) => r.id !== located.route.id) } : g
      )
      writeDesign(design)
      return jsonReply({ designId: design.id, routeId: located.route.id, deleted: true })
    }
  )

  // ── Generators ────────────────────────────────────────────────────

  mcp.registerTool(
    'generate_design_crud',
    {
      titleKey: 'mcpToolTitles.generateDesignCrud',
      title: 'Generate CRUD routes for a model',
      description:
        'The CRUD generator: a plural group + 5 routes (list, get, create, update, delete) with the {{id}} parameter ' +
        'linked to the model\'s identifier property.',
      inputSchema: {
        designId: z.string().min(1),
        model: z.string().min(1).describe('Model id or name.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.models, typeof args['model'] === 'string' ? args['model'] : '', (m) => m.doc.name, 'model')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      const { group } = generateCrud(design, resolved, newId)
      design.routeGroups = [...design.routeGroups, group]
      writeDesign(design)
      return jsonReply({ designId: design.id, groupId: group.id, routes: group.routes.length })
    }
  )

  mcp.registerTool(
    'generate_design_search_routes',
    {
      titleKey: 'mcpToolTitles.generateDesignSearchRoutes',
      title: 'Generate search parameters',
      description:
        'Add linked query parameters for every SEARCHABLE property of the model onto its list route (idempotent — ' +
        'reports changed=false when everything already exists).',
      inputSchema: {
        designId: z.string().min(1),
        model: z.string().min(1).describe('Model id or name.')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const resolved = resolveEntity(design.models, typeof args['model'] === 'string' ? args['model'] : '', (m) => m.doc.name, 'model')
      if (isResolveError(resolved)) return errorReply(resolved.error)
      const result = generateSearchParams(design, resolved, newId)
      if (result.changed) {
        design.routeGroups = result.routeGroups
        writeDesign(design)
      }
      return jsonReply({ designId: design.id, modelId: resolved.id, changed: result.changed })
    }
  )

  // ── Design server ─────────────────────────────────────────────────

  mcp.registerTool(
    'serve_design',
    {
      titleKey: 'mcpToolTitles.serveDesign',
      title: 'Serve a design',
      description:
        'Spin the design\'s local HTTP server (stateless: named examples served, constraint-validated inputs, ' +
        'group-inherited auth presence, /swagger.json self-description). Refuses a design with validation issues — ' +
        'the reply carries them so the agent can fix and retry.',
      inputSchema: { designId: z.string().min(1) } as Record<string, unknown>
    },
    async (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const issues = validateApiDesign(design)
      if (issues.length > 0) {
        return jsonReply({ started: false, error: 'design has validation issues', issues })
      }
      const result = await designServerService.start(design.toPlainObject() as unknown as ApiDesign)
      if (!result.success) return errorReply(result.error ?? 'the design server could not start')
      return jsonReply({ started: true, port: result.port, baseUrl: `http://localhost:${String(result.port)}` })
    }
  )

  mcp.registerTool(
    'generate_design_code',
    {
      titleKey: 'mcpToolTitles.generateDesignCode',
      title: 'Generate code from a design',
      description:
        'Run a Copier-format code template against the design in the SANDBOX (Pyodide MEMFS — the template never ' +
        'touches the machine). Template source: `officialId` (registry id, e.g. server-typescript), `repo` ' +
        '(owner/repo on github, fetched as an archive over the firewall) or `localPath` (a folder) — exactly one. ' +
        'Without `confirm`, replies with the PREVIEW tree only (nothing written). With `confirm: true` AND ' +
        '`outputDir` (absolute, or relative to the project file), writes the tree under it — every path ' +
        'traversal-checked first. Refuses an invalid design (same gate as serving) and an incompatible manifest.',
      inputSchema: {
        designId: z.string().min(1),
        officialId: z.string().min(1).optional(),
        repo: z.string().min(1).optional(),
        ref: z.string().min(1).optional().describe('Branch of `repo` (default main).'),
        localPath: z.string().min(1).optional(),
        answers: z.record(z.string(), z.unknown()).optional(),
        confirm: z.boolean().optional(),
        outputDir: z.string().min(1).optional()
      } as Record<string, unknown>
    },
    async (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const sources: TemplateSourceRef[] = []
      if (typeof args['officialId'] === 'string') sources.push({ kind: 'official', id: args['officialId'] })
      if (typeof args['repo'] === 'string') {
        sources.push({
          kind: 'repo',
          repo: args['repo'],
          ...(typeof args['ref'] === 'string' ? { ref: args['ref'] } : {})
        })
      }
      if (typeof args['localPath'] === 'string') sources.push({ kind: 'local', path: args['localPath'] })
      const source = sources[0]
      if (source === undefined || sources.length > 1) {
        return errorReply('pass exactly one of officialId / repo / localPath')
      }
      const answers = (args['answers'] ?? {}) as Record<string, unknown>
      try {
        const run = await designCodegenService.generate(
          design.toPlainObject() as unknown as ApiDesign,
          source,
          answers
        )
        if (args['confirm'] !== true) {
          return jsonReply({
            generated: run.preview.length,
            manifest: run.manifest,
            preview: run.preview,
            log: run.log,
            written: false,
            hint: 'call again with confirm: true and outputDir to write the tree'
          })
        }
        const outputDir = typeof args['outputDir'] === 'string' ? args['outputDir'] : ''
        if (outputDir === '') return errorReply('confirm: true needs outputDir')
        const root = resolveCodegenOutputRoot(outputDir)
        if (root === null) return errorReply('a relative outputDir needs an open project file')
        const { written } = designCodegenService.extract(
          design.id,
          root,
          design.toPlainObject() as unknown as ApiDesign
        )
        return jsonReply({ written: true, root, files: written })
      } catch (error) {
        return errorReply(error instanceof Error ? error.message : String(error))
      }
    }
  )

  mcp.registerTool(
    'stop_design_server',
    {
      titleKey: 'mcpToolTitles.stopDesignServer',
      title: 'Stop a design server',
      description: 'Stop the design\'s server, freeing its port. Idempotent.',
      inputSchema: { designId: z.string().min(1) } as Record<string, unknown>
    },
    (args) => {
      const designId = typeof args['designId'] === 'string' ? args['designId'] : ''
      const stopped = designServerService.stop(designId)
      return jsonReply({ designId, stopped })
    }
  )

  mcp.registerTool(
    'get_design_server_status',
    {
      titleKey: 'mcpToolTitles.getDesignServerStatus',
      title: 'Design server status',
      description: 'Whether the design\'s server is listening, its port, and this run\'s per-route/per-code call counters.',
      inputSchema: { designId: z.string().min(1) } as Record<string, unknown>
    },
    (args) => {
      const designId = typeof args['designId'] === 'string' ? args['designId'] : ''
      return jsonReply({ designId, ...designServerService.status(designId) })
    }
  )

  mcp.registerTool(
    'set_design_route_response',
    {
      titleKey: 'mcpToolTitles.setDesignRouteResponse',
      title: 'Force a served route\'s response',
      description:
        'Hot steering while the server runs: force a route (by id or summary) to answer a status code, with an ' +
        'optional verbatim body. Omit `code` to reset the route to its design response. Effective on the next request.',
      inputSchema: {
        designId: z.string().min(1),
        route: z.string().min(1).describe('Route id or summary.'),
        code: z.string().optional().describe('e.g. 404 or 502; omit to reset.'),
        body: z.string().optional().describe('Verbatim response body (JSON text).')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const located = findRoute(design, typeof args['route'] === 'string' ? args['route'] : '')
      if (isResolveError(located)) return errorReply(located.error)
      const code = typeof args['code'] === 'string' && args['code'] !== '' ? args['code'] : null
      const body = typeof args['body'] === 'string' && args['body'] !== '' ? args['body'] : undefined
      const applied = designServerService.setForced(
        design.id,
        located.route.id,
        code === null ? null : { code, ...(body !== undefined ? { body } : {}) }
      )
      if (!applied) return errorReply(`the design server of ${design.id} is not running`)
      return jsonReply({ designId: design.id, routeId: located.route.id, forced: code })
    }
  )

  // ── Export ────────────────────────────────────────────────────────

  mcp.registerTool(
    'export_design',
    {
      titleKey: 'mcpToolTitles.exportDesign',
      title: 'Export a design descriptor',
      description:
        'Emit the design\'s descriptor in the requested format (openapi31 today) and return it as text — ' +
        'the same emission as the Settings download button.',
      inputSchema: {
        designId: z.string().min(1),
        format: z.string().optional().describe('Descriptor format id (default openapi31).')
      } as Record<string, unknown>
    },
    (args) => {
      const design = findDesign(typeof args['designId'] === 'string' ? args['designId'] : '')
      if (!design) return errorReply(`No design with id ${String(args['designId'])}`)
      const formatId = typeof args['format'] === 'string' && args['format'] !== '' ? args['format'] : 'openapi31'
      const format = DESCRIPTOR_FORMATS.find((f) => f.id === formatId)
      if (format === undefined) {
        return errorReply(`Unknown format "${formatId}" — available: ${DESCRIPTOR_FORMATS.map((f) => f.id).join(', ')}`)
      }
      const content = format.emit(design.toPlainObject() as unknown as ApiDesign)
      return { content: [{ type: 'text', text: content }] }
    }
  )
}

/** Locate a route (and its group) by id or summary across the design. */
function findRoute(design: ApiDesign, ref: string): { group: DesignRouteGroup; route: DesignRoute } | { error: string } {
  if (ref === '') return { error: 'route is required' }
  const matches: { group: DesignRouteGroup; route: DesignRoute }[] = []
  for (const group of design.routeGroups) {
    for (const route of group.routes) {
      if (route.id === ref || route.doc.summary === ref) matches.push({ group, route })
    }
  }
  const byId = matches.find((m) => m.route.id === ref)
  if (byId !== undefined) return byId
  if (matches.length === 1) return matches[0] as { group: DesignRouteGroup; route: DesignRoute }
  if (matches.length > 1) return { error: `route summary "${ref}" is ambiguous — use the id` }
  return { error: `No route with id or summary "${ref}"` }
}
