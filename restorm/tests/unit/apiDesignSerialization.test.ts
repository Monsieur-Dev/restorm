import { describe, it, expect } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { prepareForSerialization } from '../../src/shared/utils/serialization'
import { processAfterDeserialization } from '../../src/renderer/src/utils/serialization'
import { requiredFileFormatVersion, BASE_FILE_FORMAT_VERSION, DESIGN_FILE_FORMAT_VERSION } from '../../src/shared/config/fileFormatVersion'
import { idPathSegment } from '../../src/shared/utils/stableId'
import type { ApiDesign } from '../../src/shared/types/apiDesign'
import { ApiDesign as ApiDesignModel } from '../../src/shared/models/ApiDesign'
import { buildReferenceApiDesign } from './apiDesignReference'

/**
 * The design entities ride the same persistence pipeline as every other
 * tree item. These tests prove, WITHOUT electron: the full reference
 * design (every field of the entity family populated) round-trips
 * losslessly; serialization is deterministic and key-order independent;
 * the id backfill covers every design entity; and the embedded doc /
 * example-value bags stay opaque to the walks.
 */

function dumpYaml(content: unknown): string {
  return stringifyYaml(content, { lineWidth: 0 })
}

/** The renderer's save pipeline in memory (see serialization.canonical.test.ts). */
function saveDocument(collections: unknown): string {
  const rehydrated = processAfterDeserialization(collections)
  const version = requiredFileFormatVersion(rehydrated)
  const plain = JSON.parse(JSON.stringify({ fileFormatVersion: version, collections: rehydrated })) as Record<string, unknown>
  return dumpYaml(prepareForSerialization(plain))
}

function loadDocument(rawYaml: string): { fileFormatVersion?: number; collections: unknown[] } {
  const parsed = parseYaml(rawYaml) as { fileFormatVersion?: number; collections?: unknown } | null
  return {
    ...(typeof parsed?.fileFormatVersion === 'number' && { fileFormatVersion: parsed.fileFormatVersion }),
    collections: Array.isArray(parsed?.collections) ? parsed.collections : []
  }
}

function reverseKeys<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map((v: unknown) => reverseKeys(v)) as T
  const record = data as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).reverse()) out[key] = reverseKeys(record[key])
  return out as T
}

/** A project holding the reference design next to an ordinary collection. */
function projectWithDesign(): unknown[] {
  return [
    {
      folderType: 'environment',
      id: 'env-1',
      name: 'API',
      tags: [],
      configuration: {},
      environments: [],
      items: []
    },
    buildReferenceApiDesign()
  ]
}

describe('API design — persistence round-trip', () => {
  it('the reference design survives save→load identically (every field)', () => {
    const original = buildReferenceApiDesign()
    const saved = saveDocument([original])
    const loaded = loadDocument(saved).collections[0] as ApiDesign
    // Key order differs (canonicalized); the DATA must not.
    expect(loaded).toEqual(JSON.parse(JSON.stringify(original)))
  })

  it('a project with a design persists at the design format version', () => {
    const saved = saveDocument(projectWithDesign())
    expect(loadDocument(saved).fileFormatVersion).toBe(DESIGN_FILE_FORMAT_VERSION)
    expect(saved.startsWith(`fileFormatVersion: ${String(DESIGN_FILE_FORMAT_VERSION)}\n`)).toBe(true)
  })

  it('a project without a design persists at the base version', () => {
    const saved = saveDocument([projectWithDesign()[0]])
    expect(loadDocument(saved).fileFormatVersion).toBe(BASE_FILE_FORMAT_VERSION)
  })

  it('open→save is a byte-stable fixed point', () => {
    const s1 = saveDocument(projectWithDesign())
    const s2 = saveDocument(loadDocument(s1).collections)
    expect(s2).toBe(s1)
  })

  it('two independent saves of the same design agree byte-for-byte', () => {
    expect(saveDocument(projectWithDesign())).toBe(saveDocument(projectWithDesign()))
  })

  it('key order on disk does not change what a save writes', () => {
    const saved = saveDocument(projectWithDesign())
    const shuffled = saveDocument(reverseKeys(loadDocument(saved).collections))
    expect(shuffled).toBe(saved)
  })
})

describe('API design — stable id backfill', () => {
  /** The reference design with every design-entity id removed, as a
   * legacy/hand-built file would arrive. */
  function designWithoutIds(): unknown {
    const stripDesignIds = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(stripDesignIds)
      if (node === null || typeof node !== 'object') return node
      const record = { ...(node as Record<string, unknown>) }
      if (idPathSegment(record) !== null) delete record['id']
      for (const [key, value] of Object.entries(record)) {
        if (key === 'doc' || key === 'values') continue
        record[key] = stripDesignIds(value)
      }
      return record
    }
    return stripDesignIds(JSON.parse(JSON.stringify(buildReferenceApiDesign())))
  }

  function collectIds(node: unknown, out: string[]): void {
    if (Array.isArray(node)) { node.forEach((n) => { collectIds(n, out) }); return }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (typeof record['id'] === 'string' && idPathSegment(record) !== null) out.push(record['id'])
    for (const [key, value] of Object.entries(record)) {
      if (key === 'doc' || key === 'values') continue
      collectIds(value, out)
    }
  }

  it('every design entity is classified by the id grammar', () => {
    const design = buildReferenceApiDesign()
    expect(idPathSegment(design as unknown as Record<string, unknown>)).toBe('design:Petstore design')
    const model = design.models[0] as unknown as Record<string, unknown>
    expect(idPathSegment(model)).toBe('dmodel:User')
    const property = design.models[0]?.properties[0] as unknown as Record<string, unknown>
    expect(idPathSegment(property)).toBe('dprop:id')
    const example = design.models[0]?.examples?.[0] as unknown as Record<string, unknown>
    expect(idPathSegment(example)).toBe('dexample:an admin User')
    const enumEntry = design.enums[0] as unknown as Record<string, unknown>
    expect(idPathSegment(enumEntry)).toBe('denum:UserStatus')
    const group = design.routeGroups[0] as unknown as Record<string, unknown>
    expect(idPathSegment(group)).toBe('dgroup:Users')
    const route = design.routeGroups[0]?.routes[0] as unknown as Record<string, unknown>
    expect(idPathSegment(route)).toBe('droute:GET:/{{id}}')
  })

  it('backfills a distinct id on every design entity, deterministically', () => {
    const first = processAfterDeserialization([designWithoutIds()])
    const second = processAfterDeserialization([designWithoutIds()])
    const firstIds: string[] = []
    const secondIds: string[] = []
    collectIds(first, firstIds)
    collectIds(second, secondIds)

    const expectedCount: number = countEntities(buildReferenceApiDesign())
    expect(firstIds).toHaveLength(expectedCount)
    expect(new Set(firstIds).size).toBe(expectedCount)
    // Derived, not random: both loads mint the same ids.
    expect(secondIds).toEqual(firstIds)
  })

  function countEntities(design: ApiDesign): number {
    const models = design.models.length
    const properties = design.models.reduce((n, m) => n + m.properties.length, 0)
    const examples = design.models.reduce((n, m) => n + (m.examples?.length ?? 0), 0)
    const groups = design.routeGroups.length
    const routes = design.routeGroups.reduce((n, g) => n + g.routes.length, 0)
    return 1 + models + properties + examples + design.enums.length + groups + routes
  }

  it('keeps persisted ids verbatim', () => {
    const loaded = processAfterDeserialization([buildReferenceApiDesign()])
    expect(loaded[0]?.id).toBe('design-petstore')
    expect(loaded[0]?.models[0]?.properties[0]?.id).toBe('prop-user-id')
    expect(loaded[0]?.routeGroups[0]?.routes[0]?.id).toBe('route-user-get')
  })
})

describe('API design — the doc and example bags are opaque to the walks', () => {
  it('stamps no id inside an embedded documentation object', () => {
    const design = buildReferenceApiDesign()
    // A doc example shaped exactly like an id-bearing entity (a KeyValue).
    const property = design.models[0]?.properties[0]
    if (property === undefined) throw new Error('fixture has properties')
    const trap = { key: 'Authorization', value: 'Bearer x' }
    property.doc.example = trap
    const loaded = processAfterDeserialization([design])
    const example = loaded[0]?.models[0]?.properties[0]?.doc.example as Record<string, unknown>
    expect(example).toEqual(trap)
    expect('id' in example).toBe(false)
  })

  it('stamps no id inside a named example value map', () => {
    const design = buildReferenceApiDesign()
    const example = design.models[0]?.examples?.[0]
    if (example === undefined) throw new Error('fixture has examples')
    example.values['prop-user-settings'] = { name: 'nested', variables: [] }
    const loaded = processAfterDeserialization([design])
    const value = loaded[0]?.models[0]?.examples?.[0]?.values['prop-user-settings'] as Record<string, unknown>
    expect('id' in value).toBe(false)
  })
})

describe('API design — codegen template migration (TASK-468.20)', () => {
  it('migrates a legacy single templateSource into a one-entry templates list', () => {
    const design = ApiDesignModel.fromPlain({
      name: 'X',
      codegen: { templateSource: { kind: 'official', id: 'server-typescript' }, outputDir: './out' }
    })
    expect(design.codegen?.templates).toHaveLength(1)
    const entry = design.codegen?.templates?.[0]
    expect(entry?.source).toEqual({ kind: 'official', id: 'server-typescript' })
    expect(entry?.outputDir).toBe('./out')
    expect(typeof entry?.id).toBe('string')
    // The legacy fields are dropped and never re-emitted on save.
    const codegen = design.toPlainObject()['codegen'] as Record<string, unknown>
    expect(codegen['templateSource']).toBeUndefined()
    expect(codegen['outputDir']).toBeUndefined()
    expect(Array.isArray(codegen['templates'])).toBe(true)
  })

  it('keeps a list-shaped codegen untouched', () => {
    const templates = [
      { id: 'a', source: { kind: 'repo' as const, repo: 'owner/repo' }, outputDir: './srv' },
      { id: 'b', source: { kind: 'local' as const, path: '/tmp/tpl' } }
    ]
    const design = ApiDesignModel.fromPlain({ name: 'X', codegen: { templates } })
    expect(design.codegen?.templates).toEqual(templates)
  })

  it('drops an empty codegen slot rather than persisting {}', () => {
    expect(ApiDesignModel.fromPlain({ name: 'X', codegen: {} }).codegen).toBeUndefined()
    expect(ApiDesignModel.fromPlain({ name: 'X', codegen: { templates: [] } }).codegen).toBeUndefined()
  })
})
