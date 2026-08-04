/**
 * The separation between a scenario RUN's variables and a REQUEST's own values.
 *
 * A run never writes into the request. Its values live in a disposable
 * `ResolutionContexts` composed just before each request executes, used for that
 * one dispatch and dropped. These tests assert both halves, because either one
 * alone is satisfiable by the wrong design:
 *
 * - only "the run does not leak" is satisfied by a run that never reaches the
 *   wire at all, which deletes the feature;
 * - only "the run reaches the wire" is what the leaking implementation did.
 *
 * The load-bearing assertion is on the stored OBJECT, not on a resolved value: a
 * value-level assertion can be satisfied by cleaning up at the right moment,
 * which is exactly the design this replaces.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  eventBusService: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
  createPubSub: vi.fn(() => ({ subscribe: vi.fn(() => { return () => undefined }), publish: vi.fn() })),
  serializeWithDecorators: vi.fn((value: unknown) => value)
}))

import { contextService } from '../../../src/main/services/ContextService'
import { KeyValue } from '../../../src/shared/models'
import { StringValue, ExpressionValue } from '../../../src/shared/types/collections'
import type { FullRequestData, RequestContext } from '../../../src/main/services/ContextServiceTypes'

const ENV_ID = 'env-run-separation'
const REQ_ID = 'req-run-separation'

/** The env the request itself resolves against: `petId` 9 is deliberately
 * different from the request's own row (1) and from the run's value (3), so an
 * assertion can name which of the three produced a result. */
const ENV_VARIABLES: Record<string, string> = { baseUrl: 'http://api', petId: '9', token: 'env-token' }

interface PrivateContextService {
  handleEnvironmentCreated: (payload: unknown) => void
}

function seedEnvironment(variables: Record<string, string> = ENV_VARIABLES): void {
  ;(contextService as unknown as PrivateContextService).handleEnvironmentCreated({
    id: ENV_ID,
    type: 'environment',
    document: {
      id: ENV_ID,
      name: 'E',
      variables: Object.entries(variables).map(([key, value]) => ({ key, value: { type: 'string', value } }))
    }
  })
}

function headerRow(key: string, value: string, expression = false): KeyValue {
  return new KeyValue({ id: `${key}-row`, key, value: expression ? new ExpressionValue(value) : new StringValue(value), enabled: true })
}

/** Register a request whose URL needs `petId` and whose own path-param row
 * supplies 1 — the fixture from the reported bug. */
function registerRequest(body?: FullRequestData['body']): void {
  const pathParams = [new KeyValue({ id: 'pp-petId', key: 'petId', value: new StringValue('1'), enabled: true })]
  const headers = [headerRow('Authorization', 'Bearer {{token}}', true)]
  contextService.registerRequest(REQ_ID, ENV_ID, { id: REQ_ID, headers, params: [], pathParams })
  contextService.updateFullRequestData(REQ_ID, {
    id: REQ_ID,
    requestType: 'http',
    method: 'GET',
    url: '{{baseUrl}}/pet/{{petId}}',
    headers,
    params: [],
    pathParams,
    ...(body !== undefined ? { body } : {})
  } as FullRequestData)
}

function storedContext(): RequestContext {
  const ctx = contextService.getRequestContext(REQ_ID)
  if (!ctx) throw new Error('request should be registered')
  return ctx
}

describe('disposable resolution contexts', () => {
  beforeEach(() => {
    seedEnvironment()
  })

  afterEach(() => {
    contextService.unregisterRequest(REQ_ID)
    contextService.clearAll()
  })

  describe('the request is never written by a run', () => {
    it('leaves the stored request context and the stored environment context untouched', () => {
      registerRequest()
      // Snapshot BEFORE: a structural clone, so a later in-place mutation of the
      // stored objects shows up as a difference rather than being followed.
      const before = JSON.parse(JSON.stringify({
        ctx: storedContext(),
        env: contextService.getContext(ENV_ID),
        keys: Object.keys(storedContext())
      })) as unknown

      const contexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3', token: 'run-token' })
      // Use them for everything a dispatch uses them for.
      contextService.resolveUrlForRequest(REQ_ID, contexts)
      contextService.resolveKeyValueForRequest(headerRow('Authorization', 'Bearer {{token}}', true), REQ_ID, contexts.base)
      contextService.resolveValue('{{petId}}', REQ_ID, contexts.base)

      const after = JSON.parse(JSON.stringify({
        ctx: storedContext(),
        env: contextService.getContext(ENV_ID),
        keys: Object.keys(storedContext())
      })) as unknown
      expect(after).toEqual(before)
      // And the run's values are nowhere inside the stored state at all — not
      // under a field this test happens to know the name of.
      expect(JSON.stringify(after)).not.toContain('run-token')
      expect(JSON.stringify(after)).not.toContain('"3"')
    })

    it('carries no field for a run to write into', () => {
      registerRequest()
      contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
      // The structural form of the same property: a request context that has no
      // slot for a run's values cannot hold them between runs, whatever any
      // future caller does. A value-level check would pass on a design that
      // merely cleans up at the right moment.
      expect(Object.keys(storedContext())).not.toContain('scenarioVariables')
    })

    it('hands out a fresh object each time, so a caller mutating one cannot reach the next', () => {
      registerRequest()
      const first = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
      first.base['petId'] = 'mutated'
      first.base['token'] = 'mutated'
      const second = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
      expect(second.base['petId']).toBe('3')
      expect(second.base['token']).toBe('env-token')
    })

    it('hands out a context the caller may scribble on without reaching the store', () => {
      registerRequest()
      const contexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
      // The composed context is the caller's copy. Writing into it must not
      // reach anything the service keeps — that write-through is the leak this
      // whole change exists to remove.
      contexts.base['scratch'] = 'path'
      expect(contextService.composeResolutionContexts(REQ_ID, { petId: '3' }).base['scratch']).toBeUndefined()
    })

  })

  describe('one context regardless of body type', () => {
    // The per-family split this replaced was HTTP's anatomy on a type every
    // protocol shares. Whatever the body is, a request resolves against one
    // context — so these three cases must be indistinguishable.
    for (const body of [
      { type: 'text', content: '{"id":{{petId}}}' },
      { type: 'form-data', fields: [] },
      { type: 'x-www-form-urlencoded', fields: [] }
    ] as const) {
      it(`composes the same single context for a ${body.type} body`, () => {
        registerRequest(body)
        const contexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
        expect(Object.keys(contexts).sort()).toEqual(['base', 'runOverlay'])
        expect(contexts.base['petId']).toBe('3')
      })
    }
  })

  describe('during the run, the run wins', () => {
    it('resolves the dispatch URL from the run while the request keeps its own', () => {
      registerRequest()
      const contexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })

      // The dispatch gets the run's pet…
      expect(contextService.resolveUrlForRequest(REQ_ID, contexts)?.resolvedUrl).toBe('http://api/pet/3')
      // …and, at the same instant, the request's own resolved URL — what the
      // panel shows and what a manual Send would use — is still its own row's.
      expect(contextService.resolveUrlForRequest(REQ_ID)?.resolvedUrl).toBe('http://api/pet/1')
      expect(contextService.getResolvedUrl(REQ_ID)?.resolvedUrl).toBe('http://api/pet/1')
    })

    it('resolves a header expression from the run mid-execution', () => {
      // The capability a "clean" separation would silently delete: a header
      // whose value is an expression takes the run's value while the run is in
      // flight. Measured working before this change; pinned so it stays.
      registerRequest()
      const auth = headerRow('Authorization', 'Bearer {{token}}', true)
      const contexts = contextService.composeResolutionContexts(REQ_ID, { token: 'run-token' })

      expect(contextService.resolveKeyValueForRequest(auth, REQ_ID, contexts.base)).toBe('Bearer run-token')
      // Without the run's contexts — a manual Send, the display — the same row
      // resolves from the environment.
      expect(contextService.resolveKeyValueForRequest(auth, REQ_ID)).toBe('Bearer env-token')
    })

    it('resolves a JSON body from the run mid-execution', () => {
      registerRequest({ type: 'text', content: '{"id":{{petId}}}' })
      const contexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })

      expect(contextService.resolveBodyValue('{"id":{{petId}}}', REQ_ID, 'application/json', contexts.base))
        .toBe('{"id":3}')
      expect(contextService.resolveBodyValue('{"id":{{petId}}}', REQ_ID, 'application/json'))
        .toBe('{"id":9}')
    })

    it('resolves a body FIELD from the run mid-execution', () => {
      registerRequest({ type: 'form-data', fields: [] })
      const contexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
      expect(contextService.resolveValue('{{petId}}', REQ_ID, contexts.base)).toBe('3')
    })
  })

  describe('composed per request execution, not once per run', () => {
    it('shows a variable declared between two requests to the second and not the first', () => {
      registerRequest()
      // The run's variable map as it stands before the first request…
      const first = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
      // …then the run declares `token` and moves on to the next request.
      const second = contextService.composeResolutionContexts(REQ_ID, { petId: '3', token: 'declared-mid-run' })

      expect(first.base['token']).toBe('env-token')
      expect(second.base['token']).toBe('declared-mid-run')
      // Composing once at the start of the run would have given both requests
      // the first answer, and the declaration would have had no effect.
      expect(first.base['token']).not.toBe(second.base['token'])
    })
  })

  describe('when the environment changes under the dispatch', () => {
    it('re-seeds the copy in place, keeping the run values and the object', () => {
      // A dispatch can change the environment under itself — hydrating an
      // env-folder secret fills in the plaintext after the copy was taken. The
      // copy has to follow, or the request ships the masked value; and it has to
      // follow IN THE SAME OBJECT, because the caller archives its history entry
      // from the reference it already holds.
      registerRequest()
      const contexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
      const beforeIdentity = contexts.base

      seedEnvironment({ ...ENV_VARIABLES, token: 'hydrated-token' })
      contextService.refreshResolutionContexts(REQ_ID, contexts)

      expect(contexts.base).toBe(beforeIdentity)
      expect(contexts.base['token']).toBe('hydrated-token')
      expect(contexts.base['token']).toBe('hydrated-token')
      // The run's values survive the re-seed — they are not part of what changed.
      expect(contexts.base['petId']).toBe('3')
      expect(contexts.runOverlay?.['petId']).toBe('3')
    })

    it('drops a variable the environment no longer defines instead of keeping a stale one', () => {
      registerRequest()
      const contexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
      seedEnvironment({ baseUrl: 'http://api', petId: '9' })
      contextService.refreshResolutionContexts(REQ_ID, contexts)
      expect(contexts.base['token']).toBeUndefined()
    })
  })

  describe('outside a run', () => {
    it('resolves everything from the request itself when no contexts are supplied', () => {
      registerRequest()
      expect(contextService.resolveUrlForRequest(REQ_ID)?.resolvedUrl).toBe('http://api/pet/1')
      expect(contextService.resolveValue('{{petId}}', REQ_ID)).toBe('9')
      expect(contextService.composeResolutionContexts(REQ_ID).runOverlay).toBeUndefined()
      expect(contextService.composeResolutionContexts(REQ_ID).base['petId']).toBe('9')
    })

    it('leaves a template verbatim when there is neither an environment nor a run', () => {
      contextService.registerRequest('req-bare', null, { id: 'req-bare', headers: [], params: [], pathParams: [] })
      const contexts = contextService.composeResolutionContexts('req-bare')
      // An empty disposable context must not turn "nothing to resolve against"
      // into "every variable resolves to the empty string".
      expect(contextService.resolveValue('{{petId}}', 'req-bare', contexts.base)).toBe('{{petId}}')
      contextService.unregisterRequest('req-bare')
    })
  })
})
