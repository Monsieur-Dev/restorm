/**
 * Codegen context — the versioned contract templates consume. The
 * reference design projects deterministically, cross-references travel
 * by name, and the emitted context VALIDATES against the published
 * JSON Schema (docs/contributing/design-codegen-context.schema.json) —
 * the schema is not documentation prose, it is enforced here.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildCodegenContext, CODEGEN_CONTEXT_VERSION } from '../../src/shared/design/codegenContext'
import { CODEGEN_CONTEXT_SCHEMA } from '../../src/shared/design/codegenContextSchema'
import { validateAgainstSchema } from '../../src/shared/schemaValidate'
import { resolveWithContextPriority } from '../../src/shared/utils/handlebars/resolveWithContextPriority'
import type { CodegenVarError } from '../../src/shared/design/templateVariables'
import { buildReferenceApiDesign } from './apiDesignReference'
import type { ApiDesign } from '../../src/shared/types/apiDesign'

const SCHEMA_PATH = join(__dirname, '../../docs/contributing/design-codegen-context.schema.json')

describe('buildCodegenContext', () => {
  const design = buildReferenceApiDesign()
  const context = buildCodegenContext(design)

  it('matches the golden context', async () => {
    await expect(`${JSON.stringify(context, null, 2)}\n`).toMatchFileSnapshot('./goldens/petstore.codegen-context.json')
  })

  it('validates against the bundled JSON Schema', () => {
    const result = validateAgainstSchema(context, JSON.stringify(CODEGEN_CONTEXT_SCHEMA))
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('keeps the bundled schema in sync with the published docs artifact', () => {
    // The MCP `get_design_template_contract` tool returns the BUNDLED schema
    // (the docs folder is not packaged); this guards the two from drifting.
    const published = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
    expect(CODEGEN_CONTEXT_SCHEMA).toEqual(published)
  })

  it('stamps the context version', () => {
    expect(context.contextVersion).toBe(CODEGEN_CONTEXT_VERSION)
  })

  it('projects cross-references by NAME, never by id', () => {
    const user = context.models.find((m) => m.name === 'User')
    expect(user?.properties.find((p) => p.name === 'status')?.enum).toBe('UserStatus')
    const order = context.models.find((m) => m.name === 'Order')
    expect(order?.properties.find((p) => p.name === 'customer')?.references).toEqual({ model: 'User', onDelete: 'restrict' })
    expect(order?.properties.find((p) => p.name === 'lines')?.references).toEqual({ model: 'User', onDelete: 'cascade', array: true })
    const admin = context.models.find((m) => m.name === 'AdminUser')
    expect(admin?.inherits).toBe('User')
    // No internal id leaks anywhere in the payload.
    expect(JSON.stringify(context)).not.toMatch(/(model|prop|enum|group|route|example)-/)
  })

  it('composes route paths and resolves the effective auth', () => {
    const users = context.groups.find((g) => g.name === 'Users')
    const getOne = users?.routes.find((r) => r.operationId === 'getUser')
    expect(getOne?.path).toBe('/{id}')
    expect(getOne?.fullPath).toBe('/api/v1/users/{id}')
    expect(getOne?.auth).toBe('bearer')
    expect(getOne?.params).toEqual([{ name: 'id', in: 'path', required: true, description: 'The user id.', property: { model: 'User', property: 'id' } }])
    expect(getOne?.cacheSeconds).toBe(60)
    const create = users?.routes.find((r) => r.method === 'POST')
    expect(create?.auth).toBe('none')
    expect(create?.body).toEqual({ model: 'User', contentType: 'application/json' })
  })

  it('translates example values to property names', () => {
    const user = context.models.find((m) => m.name === 'User')
    expect(user?.examples[0]?.values).toEqual({ email: 'admin@example.com', status: 'active' })
  })

  it('carries the intentions a template can honour', () => {
    const user = context.models.find((m) => m.name === 'User')
    expect(user?.volumetry).toBe('tenThousands')
    expect(user?.timestamps).toBe(true)
    expect(user?.properties.find((p) => p.name === 'email')?.pii).toBe(true)
    expect(user?.properties.find((p) => p.name === 'email')?.searchable).toBe(true)
  })

  it('projects every operational-profile intent into the model context, and omits the unset ones', () => {
    // Mutate a FRESH reference design (never the golden one) so the golden
    // match above stays intent-light and this asserts the full projection.
    const d = buildReferenceApiDesign()
    const user = d.models.find((m) => m.doc.name === 'User')
    if (!user) throw new Error('reference design is missing the User model')
    user.intents = {
      ...(user.intents ?? {}),
      accessPattern: 'readHeavy',
      traffic: 'high',
      freshness: 'longCache',
      sensitivity: 'pii',
      retention: 'archivable'
    }
    const ctx = buildCodegenContext(d)
    const u = ctx.models.find((m) => m.name === 'User')
    expect(u?.accessPattern).toBe('readHeavy')
    expect(u?.traffic).toBe('high')
    expect(u?.freshness).toBe('longCache')
    expect(u?.sensitivity).toBe('pii')
    expect(u?.retention).toBe('archivable')
    // An unset intent must be ABSENT (presence-based, like the other flags).
    const order = ctx.models.find((m) => m.name === 'Order')
    expect(order?.accessPattern).toBeUndefined()
    expect(order?.sensitivity).toBeUndefined()
    // The context still validates against the bundled schema with the new fields.
    expect(validateAgainstSchema(ctx, JSON.stringify(CODEGEN_CONTEXT_SCHEMA)).valid).toBe(true)
  })
})

describe('buildCodegenContext — user variables (vars)', () => {
  const evaluate = (expression: string, ctx: Record<string, unknown>): string =>
    resolveWithContextPriority(expression, ctx)

  it('resolves project / model / route vars into ctx.*.vars against each entity context', () => {
    const errors: CodegenVarError[] = []
    const ctx = buildCodegenContext(buildReferenceApiDesign(), {
      decls: [
        { name: 'apiTitle', scope: 'project', type: 'string', default: '{{design.name}}' },
        { name: 'table', scope: 'model', type: 'string', default: '{{model.name}}' },
        { name: 'verb', scope: 'route', type: 'string', default: '{{route.method}}' }
      ],
      evaluate,
      errors
    })
    expect(ctx.design.vars).toEqual({ apiTitle: ctx.design.name })
    expect(ctx.models.find((m) => m.name === 'User')?.vars).toEqual({ table: 'User' })
    const routes = ctx.groups.flatMap((g) => g.routes)
    expect(routes.find((r) => r.fullPath.endsWith('/{id}'))?.vars).toEqual({ verb: 'GET' })
    expect(routes.find((r) => r.method === 'POST')?.vars).toEqual({ verb: 'POST' })
    expect(errors).toEqual([])
  })

  it('applies the cascade: a per-route override beats the global value', () => {
    const errors: CodegenVarError[] = []
    const ctx = buildCodegenContext(buildReferenceApiDesign(), {
      decls: [{ name: 'useCache', scope: 'route', type: 'boolean', default: 'false' }],
      values: { route: { useCache: 'true' } }, // global: every route caches
      routeOverrides: (id) => (id === 'route-user-create' ? { useCache: 'false' } : undefined),
      evaluate,
      errors
    })
    const routes = ctx.groups.flatMap((g) => g.routes)
    expect(routes.find((r) => r.method === 'POST')?.vars).toEqual({ useCache: false })
    expect(routes.filter((r) => r.method === 'GET').every((r) => (r.vars as { useCache?: boolean } | undefined)?.useCache === true)).toBe(true)
    expect(errors).toEqual([])
  })

  it('resolves property-scope vars per property into ctx.models[].properties[].vars', () => {
    const errors: CodegenVarError[] = []
    const ctx = buildCodegenContext(buildReferenceApiDesign(), {
      decls: [{ name: 'col', scope: 'property', type: 'string', default: '{{property.name}}' }],
      evaluate,
      errors
    })
    const user = ctx.models.find((m) => m.name === 'User')
    expect(user?.properties.find((p) => p.name === 'email')?.vars).toEqual({ col: 'email' })
    expect(user?.properties.find((p) => p.name === 'id')?.vars).toEqual({ col: 'id' })
    // Inherited properties carry the resolved var in `allProperties` too.
    const admin = ctx.models.find((m) => m.name === 'AdminUser')
    expect(admin?.allProperties.find((p) => p.name === 'email')?.vars).toEqual({ col: 'email' })
    expect(errors).toEqual([])
  })

  it('applies the cascade for property scope: a per-property override beats the global', () => {
    const errors: CodegenVarError[] = []
    const ctx = buildCodegenContext(buildReferenceApiDesign(), {
      decls: [{ name: 'db', scope: 'property', type: 'string', default: 'default' }],
      values: { property: { db: 'global' } }, // every property → 'global'
      propertyOverrides: (id) => (id === 'prop-user-email' ? { db: 'override' } : undefined),
      evaluate,
      errors
    })
    const user = ctx.models.find((m) => m.name === 'User')
    expect(user?.properties.find((p) => p.name === 'email')?.vars).toEqual({ db: 'override' })
    expect(user?.properties.find((p) => p.name === 'id')?.vars).toEqual({ db: 'global' })
    expect(errors).toEqual([])
  })

  it('leaves the context free of vars when no binding is passed', () => {
    const ctx = buildCodegenContext(buildReferenceApiDesign())
    expect(ctx.design.vars).toBeUndefined()
    expect(ctx.models.every((m) => m.vars === undefined)).toBe(true)
    expect(ctx.models.flatMap((m) => m.properties).every((p) => p.vars === undefined)).toBe(true)
    expect(ctx.groups.flatMap((g) => g.routes).every((r) => r.vars === undefined)).toBe(true)
  })
})

describe('buildCodegenContext — enums / params / tags coverage', () => {
  const design = {
    id: 'd',
    info: { title: 'T', version: '1.0.0' },
    enums: [
      { id: 'e1', doc: { name: 'PetStatus', properties: [], enumValues: ['available', 'sold'] }, memberNames: ['AVAILABLE', 'SOLD'] },
      { id: 'e2', doc: { name: 'Empty', properties: [], enumValues: [] } }
    ],
    models: [{
      id: 'm', doc: { name: 'Pet' },
      properties: [
        { id: 'p1', doc: { name: 'status', type: 'string', required: false, enumValues: ['a', 'b'], deprecated: true } },
        { id: 'p2', doc: { name: 'kind', type: 'string', required: false }, design: { reference: { target: 'enum', refId: 'e1' } } }
      ]
    }],
    routeGroups: [{
      id: 'g', doc: { name: 'Pets', tags: ['pets'] },
      routes: [{
        id: 'r',
        doc: {
          match: { urlPattern: '/find', method: 'GET' },
          tags: ['list'],
          parameters: [
            { name: 'status', location: 'query', type: 'array<string>', required: true, enumValues: ['available', 'sold'], deprecated: true },
            { name: 'kind', location: 'query', type: 'string', required: false }
          ]
        },
        design: { paramEnumRefs: { kind: 'e1' } }
      }]
    }]
  } as unknown as ApiDesign

  const ctx = buildCodegenContext(design)
  const route = ctx.groups[0]?.routes[0]

  it('exposes enums including empty ones, with memberNames', () => {
    expect(ctx.enums.map((e) => e.name)).toEqual(['PetStatus', 'Empty'])
    expect(ctx.enums.find((e) => e.name === 'PetStatus')?.memberNames).toEqual(['AVAILABLE', 'SOLD'])
    expect(ctx.enums.find((e) => e.name === 'Empty')?.values).toEqual([])
  })

  it('exposes a property inline enum + deprecation, and a named enum ref', () => {
    const props = ctx.models[0]?.properties ?? []
    expect(props.find((p) => p.name === 'status')?.enumValues).toEqual(['a', 'b'])
    expect(props.find((p) => p.name === 'status')?.deprecated).toBe(true)
    expect(props.find((p) => p.name === 'kind')?.enum).toBe('PetStatus')
  })

  it('projects EVERY parameter with type / array / inline enum / enum-ref / deprecation', () => {
    const status = route?.params.find((p) => p.name === 'status')
    expect(status).toMatchObject({ in: 'query', type: 'array<string>', arrayOf: 'string', enumValues: ['available', 'sold'], required: true, deprecated: true })
    const kind = route?.params.find((p) => p.name === 'kind')
    // A named-enum reference wins over an inline type.
    expect(kind?.enum).toBe('PetStatus')
    expect(kind?.type).toBeUndefined()
  })

  it('projects group tags and the group∪route union on the route', () => {
    expect(ctx.groups[0]?.tags).toEqual(['pets'])
    expect(route?.tags).toEqual(['pets', 'list'])
  })
})
