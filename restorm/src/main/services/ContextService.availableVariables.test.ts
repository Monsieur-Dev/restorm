import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ContextService logs through electron-core-ui's LoggerService (which reads
// `app.isPackaged` at first log) and routes environment lifecycle through
// `eventBusService`. Provide a tiny in-process event bus that routes
// `emit` -> `subscribe` so the env-created event reaches the handler under the
// jsdom runner, and a `BrowserWindow` whose `webContents.send` records every
// renderer broadcast so the available-variables pushes can be asserted.
const { sentBroadcasts } = vi.hoisted(() => ({
  sentBroadcasts: [] as { channel: string; payload: unknown }[]
}))

type Handler = (payload: unknown) => void
const handlers = new Map<string, Set<Handler>>()
const testEventBus = {
  subscribe(event: string, handler: Handler) {
    let set = handlers.get(event)
    if (!set) {
      set = new Set()
      handlers.set(event, set)
    }
    const target = set
    target.add(handler)
    return { unsubscribe: () => target.delete(handler) }
  },
  emit(event: string, payload: unknown) {
    for (const h of handlers.get(event) ?? []) h(payload)
    return Promise.resolve()
  }
}

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getName: () => 'restorm', on: () => undefined },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => { sentBroadcasts.push({ channel, payload }) }
        }
      }
    ]
  }
}))

vi.mock('electron-core-ui/main', () => ({
  eventBusService: testEventBus,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createPubSub: () => ({ publish: vi.fn(), asyncIterator: vi.fn() }),
  serializeWithDecorators: (_c: unknown, o: unknown) => o
}))

const { contextService } = await import('./ContextService')
const { DocumentEvents } = await import('./DocumentEvents')
const { KeyValue } = await import('../../shared/models/KeyValue')
const { StringValue } = await import('../../shared/types/valueTypes/StringValue')

interface FieldVariablesPayload {
  variableId: string
  variables: { name: string; value: string }[]
}

function fieldBroadcast(variableId: string): FieldVariablesPayload | undefined {
  // Newest-first: the last broadcast for the field reflects the final state.
  const match = [...sentBroadcasts]
    .reverse()
    .find(
      (b) =>
        b.channel === 'context:available-variables' &&
        (b.payload as FieldVariablesPayload).variableId === variableId
    )
  return match?.payload as FieldVariablesPayload | undefined
}

/**
 * The autocompletion for a scalar `{{...}}` field draws its variable
 * suggestions from a per-field push the backend broadcasts on
 * `context:available-variables`. For a non-HTTP request the URL is not the only
 * templated field (procedure, topic, routing key, auth, ...), so the
 * environment variables are also published under a dedicated `${requestId}:env`
 * field id — independent of any field-local cumulative context — which every
 * such input subscribes to. This proves that env-only field is emitted for a
 * non-HTTP request and that it carries the environment variables without the
 * URL field's path-param additions.
 */
describe('ContextService available-variables env broadcast', () => {
  const ENV_ID = 'ctx-env-broadcast-env'

  beforeEach(() => {
    contextService.initialize() // idempotent
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
      id: ENV_ID,
      type: 'environment',
      parentEnvironmentId: null,
      document: {
        id: ENV_ID,
        name: 'Env',
        variables: [
          new KeyValue({ key: 'baseUrl', value: new StringValue('https://api.example.com') }),
          new KeyValue({ key: 'clientId', value: new StringValue('abc-123') })
        ]
      }
    })
  })

  afterEach(() => {
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: ENV_ID, type: 'environment' })
  })

  it('publishes the environment variables under `${requestId}:env` for a non-HTTP request', () => {
    const requestId = 'ctx-env-broadcast-trpc'
    contextService.registerRequest(requestId, ENV_ID, { id: requestId, headers: [] })

    sentBroadcasts.length = 0
    contextService.updateFullRequestData(requestId, {
      id: requestId,
      requestType: 'trpc',
      url: '{{baseUrl}}',
      headers: []
    })

    const env = fieldBroadcast(`${requestId}:env`)
    if (env === undefined) throw new Error('env field broadcast missing')
    const names = env.variables.map((v) => v.name)
    expect(names).toContain('baseUrl')
    expect(names).toContain('clientId')
    expect(env.variables.find((v) => v.name === 'baseUrl')?.value).toBe('https://api.example.com')

    contextService.unregisterRequest(requestId)
  })

  it('keeps the env field free of the URL field\'s path-param additions', () => {
    const requestId = 'ctx-env-broadcast-pathparams'
    contextService.registerRequest(requestId, ENV_ID, { id: requestId, headers: [] })

    sentBroadcasts.length = 0
    contextService.updateFullRequestData(requestId, {
      id: requestId,
      requestType: 'http',
      url: '{{baseUrl}}/pets/{{petId}}',
      headers: [],
      pathParams: [new KeyValue({ key: 'petId', value: new StringValue('7') })]
    })

    // The env field carries only the environment variables.
    const env = fieldBroadcast(`${requestId}:env`)
    if (env === undefined) throw new Error('env field broadcast missing')
    const envNames = env.variables.map((v) => v.name)
    expect(envNames).toContain('baseUrl')
    expect(envNames).not.toContain('petId')

    // The URL field additionally sees the request's path params.
    const urlField = fieldBroadcast(`${requestId}:url`)
    if (urlField === undefined) throw new Error('url field broadcast missing')
    const urlNames = urlField.variables.map((v) => v.name)
    expect(urlNames).toContain('baseUrl')
    expect(urlNames).toContain('petId')

    contextService.unregisterRequest(requestId)
  })
})

/**
 * When a request's own row redefines a name the environment also declares,
 * the published variable set must carry ONE entry with the EFFECTIVE value —
 * the row's, the same layering resolution applies. Publishing both layers
 * made every first-match consumer (the Monaco hover, the completion
 * description) show the environment's value while the resolved URL used the
 * row's — a tooltip that contradicted the URL right under it.
 */
describe('ContextService available-variables effective-value dedupe', () => {
  const ENV_ID = 'ctx-dedupe-env'

  beforeEach(() => {
    contextService.initialize()
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
      id: ENV_ID,
      type: 'environment',
      parentEnvironmentId: null,
      document: {
        id: ENV_ID,
        name: 'Env',
        variables: [
          new KeyValue({ key: 'baseUrl', value: new StringValue('https://api.example.com') }),
          new KeyValue({ key: 'petId', value: new StringValue('3') })
        ]
      }
    })
  })

  afterEach(() => {
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: ENV_ID, type: 'environment' })
  })

  it('the URL field publishes one petId carrying the row value, not the env value', () => {
    const requestId = 'ctx-dedupe-http'
    contextService.registerRequest(requestId, ENV_ID, { id: requestId, headers: [] })

    sentBroadcasts.length = 0
    contextService.updateFullRequestData(requestId, {
      id: requestId,
      requestType: 'http',
      url: '{{baseUrl}}/pet/{{petId}}',
      headers: [],
      pathParams: [new KeyValue({ key: 'petId', value: new StringValue('7') })]
    })

    const urlField = fieldBroadcast(`${requestId}:url`)
    if (urlField === undefined) throw new Error('url field broadcast missing')
    const petEntries = urlField.variables.filter((v) => v.name === 'petId')
    expect(petEntries, 'exactly one effective petId entry').toHaveLength(1)
    expect(petEntries[0]?.value, 'the row value must win over the env value').toBe('7')

    contextService.unregisterRequest(requestId)
  })
})
