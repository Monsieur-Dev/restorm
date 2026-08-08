import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Same harness as the env-folder secret tests: ContextService logs through
// electron-core-ui's LoggerService and routes environment lifecycle through
// `eventBusService`, so we stub the logger and provide a tiny in-process bus
// that routes `emit` → `subscribe`.
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
  BrowserWindow: { getAllWindows: () => [] }
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
const { StringValue } = await import('../../shared/types/collections')
const { ExpressionValue } = await import('../../shared/types/valueTypes/ExpressionValue')

interface EnvSpec {
  id: string
  parentEnvironmentId?: string | null
  variables: InstanceType<typeof KeyValue>[]
}

function createEnv({ id, parentEnvironmentId = null, variables }: EnvSpec): void {
  void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
    id,
    type: 'environment',
    parentEnvironmentId,
    document: { id, name: id, variables }
  })
}

function deleteEnv(id: string): void {
  void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id, type: 'environment' })
}

/**
 * An environment's variable rows are read sequentially and a later row
 * overrides an earlier one with the same key; a sub-environment overrides its
 * parent. Both rules have to hold WHATEVER value type the rows carry — an
 * imported `baseUrl` is an expression while the row the user types over it is a
 * plain string, and the two must not resolve differently just because of that.
 *
 * The regression these cover: the post-pass that re-resolves expressions
 * against the completed context re-applied every expression it found, including
 * ones a later row (or a child environment) had already overridden — so an
 * imported expression resurrected itself and the override was silently lost,
 * both in the resolved-variables table and on the wire.
 */
describe('environment variable override', () => {
  beforeEach(() => {
    contextService.initialize() // idempotent
  })

  describe('duplicate key inside one environment', () => {
    const ENV_ID = 'override-dup-env'
    afterEach(() => { deleteEnv(ENV_ID) })

    it('lets the LAST enabled row win when the first is an expression', () => {
      createEnv({
        id: ENV_ID,
        variables: [
          new KeyValue({ id: 'dup-1', key: 'baseUrl', value: new ExpressionValue('https://api.example.com') }),
          new KeyValue({ id: 'dup-2', key: 'baseUrl', value: new StringValue('abcd') })
        ]
      })

      expect(contextService.getContext(ENV_ID)?.['baseUrl']).toBe('abcd')
    })

    it('lets the LAST enabled row win when both rows are expressions', () => {
      createEnv({
        id: ENV_ID,
        variables: [
          new KeyValue({ id: 'dup-1', key: 'baseUrl', value: new ExpressionValue('https://api.example.com') }),
          new KeyValue({ id: 'dup-2', key: 'baseUrl', value: new ExpressionValue('https://staging.example.com') })
        ]
      })

      expect(contextService.getContext(ENV_ID)?.['baseUrl']).toBe('https://staging.example.com')
    })

    it('falls back to the previous row when the last one is disabled', () => {
      createEnv({
        id: ENV_ID,
        variables: [
          new KeyValue({ id: 'dup-1', key: 'baseUrl', value: new ExpressionValue('https://api.example.com') }),
          new KeyValue({ id: 'dup-2', key: 'baseUrl', value: new StringValue('abcd'), enabled: false })
        ]
      })

      expect(contextService.getContext(ENV_ID)?.['baseUrl']).toBe('https://api.example.com')
    })

    it('still lets a later expression see a variable defined after it', () => {
      // The reason the re-resolution post-pass exists: `greeting` is declared
      // before `who`, so its first resolution can't see it.
      createEnv({
        id: ENV_ID,
        variables: [
          new KeyValue({ id: 'exp-1', key: 'greeting', value: new ExpressionValue('hello {{who}}') }),
          new KeyValue({ id: 'exp-2', key: 'who', value: new StringValue('world') })
        ]
      })

      expect(contextService.getContext(ENV_ID)?.['greeting']).toBe('hello world')
    })
  })

  describe('per-row display of a row that lost its key', () => {
    const ENV_ID = 'override-display-env'
    afterEach(() => { deleteEnv(ENV_ID) })

    it('re-resolves a losing expression row against the complete context', () => {
      // `host` is declared AFTER the expression that consumes it, so the first
      // pass resolves the expression against a context that lacks it. A later
      // row then overrides `endpoint`. The losing row no longer owns the key —
      // but its own cell must still show what IT resolves to, and that is only
      // right once the complete context is available.
      createEnv({
        id: ENV_ID,
        variables: [
          new KeyValue({ id: 'loser', key: 'endpoint', value: new ExpressionValue('{{host}}/v1') }),
          new KeyValue({ id: 'host', key: 'host', value: new StringValue('https://api.example.com') }),
          new KeyValue({ id: 'winner', key: 'endpoint', value: new StringValue('https://override.example.com') })
        ]
      })

      // The context belongs to the winner...
      expect(contextService.getContext(ENV_ID)?.['endpoint']).toBe('https://override.example.com')
      // ...while the losing row still displays its own fully-resolved value,
      // not the half-resolved `/v1` the first pass produced.
      expect(contextService.getVariableTransformResult('loser')?.transformedValue)
        .toBe('https://api.example.com/v1')
    })
  })

  describe('sub-environment overriding its parent', () => {
    const PARENT_ID = 'override-parent-env'
    const CHILD_ID = 'override-child-env'
    afterEach(() => { deleteEnv(PARENT_ID) })

    it('applies the sub-environment value over an inherited expression', () => {
      createEnv({
        id: PARENT_ID,
        variables: [new KeyValue({ id: 'p-1', key: 'baseUrl', value: new ExpressionValue('https://api.example.com') })]
      })
      createEnv({
        id: CHILD_ID,
        parentEnvironmentId: PARENT_ID,
        variables: [new KeyValue({ id: 'c-1', key: 'baseUrl', value: new StringValue('abc') })]
      })

      expect(contextService.getContext(CHILD_ID)?.['baseUrl']).toBe('abc')
      // The parent keeps its own value — the child's override is local to it.
      expect(contextService.getContext(PARENT_ID)?.['baseUrl']).toBe('https://api.example.com')
    })

    it('resolves a request URL through the sub-environment value, matching the table', () => {
      const REQUEST_ID = 'override-child-request'
      createEnv({
        id: PARENT_ID,
        variables: [new KeyValue({ id: 'p-1', key: 'baseUrl', value: new ExpressionValue('https://api.example.com') })]
      })
      createEnv({
        id: CHILD_ID,
        parentEnvironmentId: PARENT_ID,
        variables: [
          // Both symptoms at once: a duplicate key inside the active
          // sub-environment, which itself overrides the parent.
          new KeyValue({ id: 'c-1', key: 'baseUrl', value: new ExpressionValue('https://first.example.com') }),
          new KeyValue({ id: 'c-2', key: 'baseUrl', value: new StringValue('https://last.example.com') })
        ]
      })

      contextService.registerRequest(REQUEST_ID, CHILD_ID, { id: REQUEST_ID, headers: [] })
      contextService.updateFullRequestData(REQUEST_ID, {
        id: REQUEST_ID,
        requestType: 'http',
        method: 'GET',
        url: '{{baseUrl}}/my/action',
        headers: []
      })

      // The resolved-variables table and the URL read the same context, so
      // they can only ever agree.
      expect(contextService.getContext(CHILD_ID)?.['baseUrl']).toBe('https://last.example.com')
      expect(contextService.getResolvedUrl(REQUEST_ID)?.resolvedUrl).toBe('https://last.example.com/my/action')

      contextService.unregisterRequest(REQUEST_ID)
    })

    it('feeds headers and params the same overridden value as the URL', () => {
      // Headers and params come off the same kvtable and resolve against the
      // same environment context as the URL, so the override has to reach them
      // identically — a header that says `{{baseUrl}}` cannot disagree with the
      // URL that says `{{baseUrl}}`.
      const REQUEST_ID = 'override-child-kv-request'
      createEnv({
        id: PARENT_ID,
        variables: [new KeyValue({ id: 'p-1', key: 'baseUrl', value: new ExpressionValue('https://api.example.com') })]
      })
      createEnv({
        id: CHILD_ID,
        parentEnvironmentId: PARENT_ID,
        variables: [
          new KeyValue({ id: 'c-1', key: 'baseUrl', value: new ExpressionValue('https://first.example.com') }),
          new KeyValue({ id: 'c-2', key: 'baseUrl', value: new StringValue('https://last.example.com') })
        ]
      })

      contextService.registerRequest(REQUEST_ID, CHILD_ID, { id: REQUEST_ID, headers: [] })

      const header = new KeyValue({ key: 'X-Origin', value: new ExpressionValue('{{baseUrl}}') })
      const param = new KeyValue({ key: 'callback', value: new ExpressionValue('{{baseUrl}}/cb') })
      expect(contextService.resolveKeyValueForRequest(header, REQUEST_ID)).toBe('https://last.example.com')
      expect(contextService.resolveKeyValueForRequest(param, REQUEST_ID)).toBe('https://last.example.com/cb')

      contextService.unregisterRequest(REQUEST_ID)
    })

    it('still re-resolves an inherited expression against a variable the child overrides', () => {
      // The reason the inherited-expression post-pass exists: the parent's
      // `baseUrl` composes `scheme`, which the child redefines.
      createEnv({
        id: PARENT_ID,
        variables: [
          new KeyValue({ id: 'p-1', key: 'scheme', value: new StringValue('http') }),
          new KeyValue({ id: 'p-2', key: 'baseUrl', value: new ExpressionValue('{{scheme}}://api.example.com') })
        ]
      })
      createEnv({
        id: CHILD_ID,
        parentEnvironmentId: PARENT_ID,
        variables: [new KeyValue({ id: 'c-1', key: 'scheme', value: new StringValue('https') })]
      })

      expect(contextService.getContext(CHILD_ID)?.['baseUrl']).toBe('https://api.example.com')
    })
  })
})
