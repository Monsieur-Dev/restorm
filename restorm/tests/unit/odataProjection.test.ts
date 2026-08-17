/**
 * OData projection — CSDL emission, entity-set derivation and the
 * round-trip guarantee: the emitted `$metadata` must parse back through
 * the app's own EDMX importer with the same types, keys and sets.
 */

import { describe, it, expect } from 'vitest'
import {
  buildODataRows,
  designODataEntitySets,
  designODataNamespace,
  designToCsdl,
  matchODataEntity,
  odataKeyPropertyName,
  ODATA_MAX_SERVED_ROWS
} from '../../src/shared/design/odataProjection'
import { parseEdmxV4 } from '../../src/main/services/import/ODataImportService'
import { applyODataQuery } from '../../src/shared/utils/odataServerQuery'
import { buildReferenceApiDesign } from './apiDesignReference'

describe('designToCsdl', () => {
  const design = buildReferenceApiDesign()
  const csdl = designToCsdl(design)

  it('matches the golden CSDL', async () => {
    await expect(csdl).toMatchFileSnapshot('./goldens/petstore.metadata.xml')
  })

  it('round-trips through the EDMX importer', () => {
    const schema = parseEdmxV4(csdl)
    const typeNames = schema.entityTypes.map((t) => t.name)
    expect(typeNames).toEqual(expect.arrayContaining(['User', 'AdminUser', 'Order']))

    const user = schema.entityTypes.find((t) => t.name === 'User')
    expect(user?.keys).toEqual(['id'])
    // The inherited chain resolves the SAME key for the child model.
    expect(schema.entityTypes.find((t) => t.name === 'AdminUser')?.keys).toEqual(['id'])
    expect(user?.properties.map((p) => p.name)).toEqual(
      expect.arrayContaining(['id', 'email', 'password', 'status', 'nicknames', 'settings'])
    )
    // Required survives as Nullable="false".
    expect(user?.properties.find((p) => p.name === 'email')?.nullable).toBe(false)
    // The model reference is a navigation property, not a structural one.
    const order = schema.entityTypes.find((t) => t.name === 'Order')
    expect(order?.navigationProperties.map((p) => p.name)).toEqual(expect.arrayContaining(['customer', 'lines']))
    expect(order?.navigationProperties.find((p) => p.name === 'lines')?.collection).toBe(true)

    expect(schema.enumTypes.length).toBeGreaterThan(0)
    expect(schema.entitySets.map((s) => s.name)).toEqual(expect.arrayContaining(['Users', 'AdminUsers', 'Orders']))
  })

  it('namespaces off the API title', () => {
    expect(designODataNamespace(design)).toBe('Petstore')
    expect(csdl).toContain('Namespace="Petstore"')
  })
})

describe('entity sets and served rows', () => {
  const design = buildReferenceApiDesign()
  const sets = designODataEntitySets(design)

  it('derives one pluralized set per model, collision-free', () => {
    expect(sets.map((s) => s.name)).toEqual(['Users', 'AdminUsers', 'Orders'])
    expect(new Set(sets.map((s) => s.name)).size).toBe(sets.length)
  })

  it('keys on the declared identifier', () => {
    const users = sets.find((s) => s.name === 'Users')
    expect(users !== undefined && odataKeyPropertyName(design, users.model)).toBe('id')
  })

  it('serves bounded deterministic rows, named examples first', () => {
    const users = sets.find((s) => s.name === 'Users')
    expect(users).toBeDefined()
    if (users === undefined) return
    const rows = buildODataRows(design, users.model)
    expect(rows.length).toBeLessThanOrEqual(ODATA_MAX_SERVED_ROWS)
    expect(rows[0]?.['email']).toBe('admin@example.com')
    expect(buildODataRows(design, users.model)).toEqual(rows)
  })

  it('addresses one entity by key, quoted or not', () => {
    const users = sets.find((s) => s.name === 'Users')
    if (users === undefined) return
    const rows = buildODataRows(design, users.model)
    const id = String(rows[0]?.['id'])
    expect(matchODataEntity(design, users.model, rows, id)?.['email']).toBe('admin@example.com')
    expect(matchODataEntity(design, users.model, rows, `'${id}'`)?.['email']).toBe('admin@example.com')
    expect(matchODataEntity(design, users.model, rows, 'nope')).toBeUndefined()
  })

  it('rows compose with the OData query engine', () => {
    const users = sets.find((s) => s.name === 'Users')
    if (users === undefined) return
    const rows = buildODataRows(design, users.model)
    const result = applyODataQuery(rows, { top: 2, count: true, select: ['email'] })
    expect(result.value).toHaveLength(2)
    expect(result.count).toBe(rows.length)
    expect(Object.keys(result.value[0] ?? {})).toEqual(['email'])
  })
})
