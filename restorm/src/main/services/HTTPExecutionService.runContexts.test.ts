/**
 * What reaches the WIRE, before and after a scenario run touches a request.
 *
 * The reported defect was not a stale display: after a run, pressing Send on the
 * request dispatched the RUN's resource while the request's own row still read
 * its own value — a DELETE or a PUT aimed at the wrong record with the right
 * value on screen. So the assertion here is on the URL and headers handed to the
 * transport, in sequence: a run dispatch, then a plain dispatch of the same
 * request, then the request's stored state.
 *
 * The real `ContextService` is used (only the transport is stubbed) so the
 * composition under test is the production one, not a premise this file states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  eventBusService: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
  createPubSub: () => ({ publish: vi.fn(), subscribe: vi.fn(), asyncIterator: vi.fn() }),
  serializeWithDecorators: (value: unknown) => value,
  withFirewallBypass: <T>(fn: () => T): T => fn(),
  isFirewallBypassed: () => false,
  firewallService: { emit: vi.fn() },
  permissionService: { classify: () => 'allow', check: () => Promise.resolve('allow' as const) }
}))

vi.mock('undici', () => ({ request: vi.fn() }))

import { httpExecutionService } from './HTTPExecutionService'
import { contextService } from './ContextService'
import { request as undiciRequestMock } from 'undici'
import { KeyValue } from '../../shared/models'
import { StringValue, ExpressionValue } from '../../shared/types/collections'
import type { FullRequestData } from './ContextServiceTypes'

const undiciRequestSpy = vi.mocked(undiciRequestMock)

const ENV_ID = 'env-wire'
const REQ_ID = 'req-wire'

function undiciOk(): { statusCode: number; headers: Record<string, string>; body: Readable } {
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: Readable.from([Buffer.from('{}')]) }
}

/** The URL + headers handed to the transport on dispatch number `index`. */
function dispatched(index: number): { url: string; headers: Record<string, string> } {
  const call = undiciRequestSpy.mock.calls[index]
  const target = call?.[0]
  const options = call?.[1] as { headers?: Record<string, string> } | undefined
  const url = typeof target === 'string' ? target : target instanceof URL ? target.href : ''
  return { url, headers: options?.headers ?? {} }
}

function seedEnvironment(): void {
  ;(contextService as unknown as { handleEnvironmentCreated: (p: unknown) => void }).handleEnvironmentCreated({
    id: ENV_ID,
    type: 'environment',
    document: {
      id: ENV_ID,
      name: 'E',
      variables: [
        { key: 'baseUrl', value: { type: 'string', value: 'http://api.test' } },
        { key: 'petId', value: { type: 'string', value: '9' } },
        { key: 'token', value: { type: 'string', value: 'env-token' } }
      ]
    }
  })
}

/** The reported fixture: three distinct values for `petId` — the request's own
 * row (1), the environment (9) and the run (3) — so a failure names which layer
 * reached the wire instead of only reporting a mismatch. */
function registerRequest(): void {
  const pathParams = [new KeyValue({ id: 'pp', key: 'petId', value: new StringValue('1'), enabled: true })]
  const headers = [new KeyValue({ id: 'h', key: 'Authorization', value: new ExpressionValue('Bearer {{token}}'), enabled: true })]
  contextService.registerRequest(REQ_ID, ENV_ID, { id: REQ_ID, headers, params: [], pathParams })
  contextService.updateFullRequestData(REQ_ID, {
    id: REQ_ID,
    requestType: 'http',
    method: 'GET',
    url: '{{baseUrl}}/pet/{{petId}}',
    headers,
    params: [],
    pathParams
  } as FullRequestData)
}

describe('HTTP dispatch — a run reaches the wire, and stops there', () => {
  beforeEach(() => {
    undiciRequestSpy.mockReset()
    undiciRequestSpy.mockResolvedValue(undiciOk() as unknown as Awaited<ReturnType<typeof undiciRequestMock>>)
    seedEnvironment()
    registerRequest()
  })

  afterEach(() => {
    contextService.unregisterRequest(REQ_ID)
    contextService.clearAll()
  })

  it('sends the run\'s resource during the run and the request\'s own right after it', async () => {
    const runContexts = contextService.composeResolutionContexts(REQ_ID, { petId: '3', token: 'run-token' })

    const during = await httpExecutionService.execute({ requestId: REQ_ID, method: 'GET', runContexts })
    expect(during.success).toBe(true)
    expect(dispatched(0).url).toBe('http://api.test/pet/3')
    expect(dispatched(0).headers['Authorization']).toBe('Bearer run-token')

    // The run is over. This is the user pressing Send on the request — the
    // dispatch that used to reach the run's resource while the row on screen
    // read 1.
    const after = await httpExecutionService.execute({ requestId: REQ_ID, method: 'GET' })
    expect(after.success).toBe(true)
    expect(dispatched(1).url).toBe('http://api.test/pet/1')
    expect(dispatched(1).headers['Authorization']).toBe('Bearer env-token')

    // …and the resolved URL the request panel shows agrees with what was sent,
    // at both instants. The two disagreeing is the defect itself.
    expect(contextService.getResolvedUrl(REQ_ID)?.resolvedUrl).toBe('http://api.test/pet/1')
    expect(Object.keys(contextService.getRequestContext(REQ_ID) ?? {})).not.toContain('scenarioVariables')
  })

  it('does not carry one run\'s values into the next', async () => {
    await httpExecutionService.execute({
      requestId: REQ_ID,
      method: 'GET',
      runContexts: contextService.composeResolutionContexts(REQ_ID, { petId: '3' })
    })
    await httpExecutionService.execute({
      requestId: REQ_ID,
      method: 'GET',
      runContexts: contextService.composeResolutionContexts(REQ_ID, { petId: '7' })
    })

    expect(dispatched(0).url).toBe('http://api.test/pet/3')
    expect(dispatched(1).url).toBe('http://api.test/pet/7')
  })
})
