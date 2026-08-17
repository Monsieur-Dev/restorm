/**
 * TASK-468.17 — the whole chain in one pass: import an OpenAPI spec →
 * derive a design (designFromDocumentation) → project it back to the
 * served spec (what /swagger.json emits: designToApiDocumentation →
 * apiDocumentationToOpenApi, OAS 3.0) → re-import that served spec. The
 * ApiDocumentation from the FIRST import and from the re-import must be
 * structurally identical, the only tolerated difference being the base
 * URL (the design server's local host/port). Any other divergence is a
 * bug in one of the links — fix the link, never loosen this assertion.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { openapi3ToApiDocumentation } from '../../src/main/services/import/transformers/openapi3ToApiDocumentation'
import type { OAS3Spec } from '../../src/main/services/import/transformers/openapi3ToApiDocumentation'
import { designFromDocumentation } from '../../src/shared/design/designFromDocumentation'
import { designToApiDocumentation } from '../../src/shared/design/apiDesignDoc'
import { apiDocumentationToOpenApi } from '../../src/shared/design/openApiExport'
import type { ApiDocumentation } from '../../src/shared/types/apiDocumentation'

/**
 * Normalize the two tolerated differences before comparing:
 *  1. the base URL (the design server's local host/port), and
 *  2. an OAS TAG that no operation uses — a design has route GROUPS
 *     (which hold routes), so it has no concept of an empty group and
 *     legitimately drops an unused tag. Yoann approved tolerating this
 *     one case (2026-08-17); everything else must be strictly identical.
 */
function normalize(doc: ApiDocumentation): ApiDocumentation {
  const clone = structuredClone(doc) as ApiDocumentation & { api: { baseUrl?: string } }
  clone.api.baseUrl = ''
  const used = new Set(clone.operations.map((op) => op.group))
  clone.groups = Object.fromEntries(
    Object.entries(clone.groups).filter(([name]) => used.has(name))
  )
  return clone
}

describe('TASK-468.17 — import → design → serve → re-import is lossless', () => {
  it('the two ApiDocumentations are structurally identical (modulo base URL)', () => {
    const specPath = join(__dirname, 'fixtures/openapi/petstore-3.0.json')
    const spec = JSON.parse(readFileSync(specPath, 'utf8')) as OAS3Spec

    const doc1 = openapi3ToApiDocumentation(spec)

    let seq = 0
    const newId = (): string => `rt-${++seq}`
    const design = designFromDocumentation('Petstore', doc1, newId)

    const servedSpec = apiDocumentationToOpenApi(designToApiDocumentation(design)) as unknown as OAS3Spec
    const doc2 = openapi3ToApiDocumentation(servedSpec)

    expect(normalize(doc2)).toEqual(normalize(doc1))
  })
})
