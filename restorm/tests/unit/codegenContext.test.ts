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
import { buildReferenceApiDesign } from './apiDesignReference'

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
    expect(getOne?.params).toEqual([{ name: 'id', property: { model: 'User', property: 'id' } }])
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
})
