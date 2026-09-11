import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  openapi3ToApiDocumentation,
  type OAS3Spec
} from '../../../src/main/services/import/transformers/openapi3ToApiDocumentation'
import { designFromDocumentation, specPathToRestorm } from '../../../src/shared/design/designFromDocumentation'
import { validateApiDesign, type DesignIssueCode } from '../../../src/shared/design/validateApiDesign'
import { describeDesignIssue } from '../../../src/shared/design/describeDesignIssue'

/**
 * Guards the WHOLE background-validation pipeline the main process runs after an
 * import / open: OpenAPI spec → ApiDocumentation → ApiDesign → DesignIssue[].
 *
 * It also pins the e2e fixture (`design-issues-3.0.json`): the API-design-issues
 * e2e asserts that importing this spec lights up the sidebar "!" and the "Issues"
 * tab, so it must actually project to a non-empty issue set. The spec is
 * deliberately flawed in three independent ways, each a different issue TYPE.
 */
describe('API design validation — import → design → validate pipeline', () => {
  const FIXTURES = join(__dirname, '../fixtures/openapi')
  const spec = JSON.parse(readFileSync(join(FIXTURES, 'design-issues-3.0.json'), 'utf-8')) as OAS3Spec

  function issuesFor(s: OAS3Spec): ReturnType<typeof validateApiDesign> {
    const doc = openapi3ToApiDocumentation(s)
    let counter = 0
    const design = designFromDocumentation('Design Issues API', doc, () => `tmp-${counter++}`)
    return validateApiDesign(design)
  }

  it('projects the flawed spec to a non-empty issue set', () => {
    expect(issuesFor(spec).length).toBeGreaterThan(0)
  })

  it('flags the two same-surface routes as a duplicate-path collision (every member)', () => {
    const dup = issuesFor(spec).filter((i) => i.code === 'routePathDuplicate')
    // /items/{id} GET and /items/{itemId} GET normalize to the same templated
    // surface — both must be flagged, each pointing at the other.
    expect(dup.length).toBe(2)
    for (const iss of dup) expect(iss.collisionWith?.length).toBe(1)
  })

  it('flags the operation that declares no response', () => {
    const codes = issuesFor(spec).map((i) => i.code)
    expect(codes).toContain<DesignIssueCode>('routeResponsesMissing')
  })

  it('flags the route that sits on a path the design server reserves', () => {
    const codes = issuesFor(spec).map((i) => i.code)
    // /swagger.json would be shadowed by the design server's descriptor route.
    expect(codes).toContain<DesignIssueCode>('routePathReserved')
  })

  it('reports at least three distinct issue TYPES (a maximum of problems surfaced)', () => {
    const distinct = new Set(issuesFor(spec).map((i) => i.code))
    expect(distinct.size).toBeGreaterThanOrEqual(3)
  })

  it('resolves each route issue to its concrete method + real path (not the normalized surface)', () => {
    const doc = openapi3ToApiDocumentation(spec)
    let counter = 0
    const design = designFromDocumentation('Design Issues API', doc, () => `tmp-${counter++}`)
    const labels = validateApiDesign(design)
      .filter((i) => i.code === 'routePathDuplicate')
      .map((i) => describeDesignIssue(design, i).label)
    // The two colliding routes keep their DISTINCT real param names — the whole
    // point of surfacing the concrete offenders instead of "GET /items/{*}".
    expect(labels).toContain('GET /items/{id}')
    expect(labels).toContain('GET /items/{itemId}')
  })

  it('resolves a route locator that matches an operation even when the spec declares a server base path', () => {
    // Regression: a server url with a path (e.g. https://x/v1) is stored as the
    // design's server base, NOT on the operation's urlPattern. The route locator
    // must stay matchable against `op.match.urlPattern` (base-less), or the
    // renderer can never find the operation to render its documentation.
    const withServer: OAS3Spec = {
      openapi: '3.0.0',
      info: { title: 'Based API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com/v1' }],
      paths: {
        '/items/{id}': { get: { operationId: 'a', tags: ['Items'], responses: {} } },
        '/items/{itemId}': { get: { operationId: 'b', tags: ['Items'], responses: {} } }
      }
    } as unknown as OAS3Spec
    const doc = openapi3ToApiDocumentation(withServer)
    let counter = 0
    const design = designFromDocumentation('Based API', doc, () => `tmp-${counter++}`)
    const dupIssues = validateApiDesign(design).filter((i) => i.code === 'routePathDuplicate')
    expect(dupIssues.length).toBe(2)
    for (const iss of dupIssues) {
      const { route } = describeDesignIssue(design, iss)
      expect(route).toBeDefined()
      // The renderer's findOperation compares specPathToRestorm(op pattern) to
      // route.pattern; assert at least one operation matches (would be zero if
      // the pattern were over-qualified with the server base path).
      const match = doc.operations.some((op) => specPathToRestorm(op.match.urlPattern) === route?.pattern)
      expect(match, `no operation matches locator ${route?.pattern}`).toBe(true)
    }
  })

  it('carries a route locator (method + restorm pattern) for a route issue', () => {
    const doc = openapi3ToApiDocumentation(spec)
    let counter = 0
    const design = designFromDocumentation('Design Issues API', doc, () => `tmp-${counter++}`)
    const reserved = validateApiDesign(design).find((i) => i.code === 'routePathReserved')
    expect(reserved).toBeDefined()
    const subject = reserved !== undefined ? describeDesignIssue(design, reserved) : undefined
    expect(subject?.route).toEqual({ method: 'GET', pattern: '/swagger.json' })
  })
})
