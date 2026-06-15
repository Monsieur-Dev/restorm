import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ContextService logs through electron-core-ui's LoggerService (which reads
// `app.isPackaged` at first log) and routes environment lifecycle through
// `eventBusService`. Stub the logger and provide a tiny in-process event bus
// that actually routes `emit` → `subscribe`, so the env-created event reaches
// ContextService's handler under the jsdom runner. `BrowserWindow` is stubbed
// for the renderer-broadcast path.
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

const { contextService } = await import('../ContextService')
const { secretHydrationService } = await import('./SecretHydrationService')
const { registerBuiltinSources, registerResolverForTests } = await import('./mainSourceRegistry')
const { DocumentEvents } = await import('../DocumentEvents')
const { KeyValue } = await import('../../../shared/models/KeyValue')
const { SecretValue } = await import('../../../shared/types/valueTypes/SecretValue')
const { ExpressionValue } = await import('../../../shared/types/valueTypes/ExpressionValue')

/**
 * An env-folder *variable* whose value is a `SecretValue` must resolve to its
 * provider plaintext when used by a request — not just request KeyValue
 * secrets. The seam: `collectEnvironmentSecrets(requestId)` gathers the
 * secrets in the active env chain, hydration populates each `.resolved`, and
 * `refreshEnvironmentContext(requestId)` re-runs the env context so the
 * plaintext lands in the request's baseContext. A header templated as
 * `{{apiKey}}` then resolves to it.
 */
describe('env-folder secret hydration seam', () => {
  const ENV_ID = 'env-folder-secret-env'
  const REQUEST_ID = 'env-folder-secret-req'
  const ENV_NAME = 'RESTORM_ENV_FOLDER_SECRET_TOKEN'

  beforeEach(() => {
    contextService.initialize() // idempotent
    registerBuiltinSources() // idempotent
    process.env[ENV_NAME] = 'env-folder-secret-value'
    secretHydrationService.clearScope(ENV_ID)

    // The env-folder carries one variable `apiKey` resolved from the env var.
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
      id: ENV_ID,
      type: 'environment',
      parentEnvironmentId: null,
      document: {
        id: ENV_ID,
        name: 'Secrets',
        variables: [
          new KeyValue({ key: 'apiKey', value: new SecretValue('envVar', { name: ENV_NAME }) })
        ]
      }
    })

    // A request under that environment, with a header templated from the
    // env variable.
    contextService.registerRequest(REQUEST_ID, ENV_ID, {
      id: REQUEST_ID,
      headers: [new KeyValue({ key: 'X-Api-Key', value: new ExpressionValue('{{apiKey}}') })]
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, ENV_NAME)
    secretHydrationService.clearScope(ENV_ID)
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: ENV_ID, type: 'environment' })
  })

  it('auto-hydrates the env-folder SecretValue into the context on open', async () => {
    // Opening the env-folder (ENVIRONMENT_CREATED) kicks off async hydration;
    // once it lands the context carries the resolved plaintext (it starts
    // masked to '' synchronously, then fills in).
    await vi.waitFor(() => {
      expect(contextService.getContext(ENV_ID)?.apiKey).toBe('env-folder-secret-value')
    })
  })

  it('collects the env-folder SecretValue for the request', () => {
    const secrets = contextService.collectEnvironmentSecrets(REQUEST_ID)
    expect(secrets).toHaveLength(1)
    expect(secrets[0]).toBeInstanceOf(SecretValue)
    expect(secrets[0].source).toBe('envVar')
  })

  it('resolves the env-folder secret into the request context after hydrate + refresh', async () => {
    const secrets = contextService.collectEnvironmentSecrets(REQUEST_ID)
    await secretHydrationService.hydrate(ENV_ID, secrets)
    contextService.refreshEnvironmentContext(REQUEST_ID)

    // The env variable now carries the resolved plaintext...
    expect(contextService.getContext(ENV_ID)?.apiKey).toBe('env-folder-secret-value')

    // ...and a request header templated from it resolves through too.
    const header = new KeyValue({ key: 'X-Api-Key', value: new ExpressionValue('{{apiKey}}') })
    expect(contextService.resolveKeyValueForRequest(header, REQUEST_ID)).toBe('env-folder-secret-value')
  })
})

/**
 * Opening an env-folder must hydrate its SecretValue variables straight into
 * the environment context — no request involved. The repro: `apiKey` is a
 * `SecretValue`, and a second variable `apiKey2 = {{apiKey}}` (an expression)
 * must resolve to the secret's plaintext, not the masked empty string. The
 * regression was that the env context masked secrets to '' before any
 * expression depending on them was resolved, so `apiKey2` came out blank.
 */
describe('env-folder secret hydration into the environment context (open path)', () => {
  const ENV_ID = 'env-folder-secret-open-env'
  const ENV_NAME = 'RESTORM_ENV_FOLDER_OPEN_SECRET_TOKEN'

  beforeEach(() => {
    contextService.initialize() // idempotent
    registerBuiltinSources() // idempotent
    process.env[ENV_NAME] = 'open-path-secret-value'
    secretHydrationService.clearScope(ENV_ID)
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, ENV_NAME)
    secretHydrationService.clearScope(ENV_ID)
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: ENV_ID, type: 'environment' })
  })

  it('hydrates secrets into the env context so an expression composing them resolves', async () => {
    // `apiKey` is a secret; `apiKey2` is an expression referencing it. Order
    // matters — apiKey2 is defined after apiKey so the context already holds
    // the resolved secret when apiKey2 is evaluated.
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
      id: ENV_ID,
      type: 'environment',
      parentEnvironmentId: null,
      document: {
        id: ENV_ID,
        name: 'Secrets',
        variables: [
          new KeyValue({ key: 'apiKey', value: new SecretValue('envVar', { name: ENV_NAME }) }),
          new KeyValue({ key: 'apiKey2', value: new ExpressionValue('{{apiKey}}') })
        ]
      }
    })

    // Before hydration completes the secret (and thus the expression) is empty.
    expect(contextService.getContext(ENV_ID)?.apiKey).toBe('')
    expect(contextService.getContext(ENV_ID)?.apiKey2).toBe('')

    // Drive the async hydration the ENVIRONMENT_CREATED handler kicked off to
    // completion, then assert both the secret and the expression composing it
    // now carry the resolved plaintext.
    await vi.waitFor(() => {
      expect(contextService.getContext(ENV_ID)?.apiKey).toBe('open-path-secret-value')
      expect(contextService.getContext(ENV_ID)?.apiKey2).toBe('open-path-secret-value')
    })
  })
})

/**
 * One failing secret must not poison the whole env's hydration. The repro: an
 * env with a secret that can't resolve (a missing env var → the resolver
 * rejects) defined BEFORE a healthy secret. A non-resilient batch hydrate aborts
 * on the first rejection, so the healthy secret never resolves and the context
 * is never rebroadcast. Resilience: each secret resolves independently — the
 * failing one stays empty, the healthy one still fills in.
 */
describe('env-folder secret hydration resilience (one failing secret)', () => {
  const ENV_ID = 'env-folder-secret-resilience-env'
  const GOOD_ENV = 'RESTORM_RESILIENCE_GOOD_TOKEN'
  const MISSING_ENV = 'RESTORM_RESILIENCE_MISSING_TOKEN_UNSET'

  beforeEach(() => {
    contextService.initialize() // idempotent
    registerBuiltinSources() // idempotent
    process.env[GOOD_ENV] = 'good-secret-value'
    Reflect.deleteProperty(process.env, MISSING_ENV)
    secretHydrationService.clearScope(ENV_ID)
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, GOOD_ENV)
    secretHydrationService.clearScope(ENV_ID)
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: ENV_ID, type: 'environment' })
  })

  it('still resolves a healthy secret when an earlier secret fails to resolve', async () => {
    // `failing` (missing env var → resolver rejects) is defined BEFORE `good`.
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
      id: ENV_ID,
      type: 'environment',
      parentEnvironmentId: null,
      document: {
        id: ENV_ID,
        name: 'Secrets',
        variables: [
          new KeyValue({ key: 'failing', value: new SecretValue('envVar', { name: MISSING_ENV }) }),
          new KeyValue({ key: 'good', value: new SecretValue('envVar', { name: GOOD_ENV }) })
        ]
      }
    })

    // The healthy secret resolves despite the earlier failure...
    await vi.waitFor(() => {
      expect(contextService.getContext(ENV_ID)?.good).toBe('good-secret-value')
    })
    // ...and the failing one is simply empty (not blocking the rest).
    expect(contextService.getContext(ENV_ID)?.failing).toBe('')
  })
})

/**
 * A slow secret fetch must be ABORTED when its environment is deleted or the
 * project is closed — otherwise the resolver (a long network / file fetch)
 * keeps running and then recomputes / spins for a gone environment. A
 * test-local `slowTest` resolver honours the abort signal, so a deleted /
 * cleared env stops resolving immediately and never lands its value.
 */
describe('env-folder secret hydration cancellation on close', () => {
  const ENV_ID = 'env-folder-secret-cancel-env'
  // Long enough that the fetch is still pending when we delete / clear.
  const SLOW_PARAMS = { value: 'slow-cancel-value', delayMs: '5000' }

  // A deliberately-slow, abort-honouring resolver, registered only for these
  // tests (the production registry ships no such source).
  const slowResolver = {
    id: 'slowTest',
    read(params: Record<string, unknown>, ctx: { signal?: AbortSignal }): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        if (ctx.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
        const delay = typeof params.delayMs === 'string' ? Number(params.delayMs) : 5000
        const timer = setTimeout(() => {
          resolve(typeof params.value === 'string' ? params.value : 'slow')
        }, delay)
        ctx.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      })
    }
  }

  beforeEach(() => {
    contextService.initialize() // idempotent
    registerBuiltinSources() // idempotent
    registerResolverForTests(slowResolver)
    secretHydrationService.clearScope(ENV_ID)
  })

  afterEach(() => {
    secretHydrationService.clearScope(ENV_ID)
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: ENV_ID, type: 'environment' })
  })

  const openEnvWithSlowSecret = (): void => {
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
      id: ENV_ID,
      type: 'environment',
      parentEnvironmentId: null,
      document: {
        id: ENV_ID,
        name: 'Secrets',
        variables: [new KeyValue({ key: 'slow', value: new SecretValue('slowTest', SLOW_PARAMS) })]
      }
    })
  }

  it('aborts an in-flight hydration and clears the resolving state when the env is deleted', async () => {
    openEnvWithSlowSecret()
    await vi.waitFor(() => {
      expect(contextService.getResolvingEnvironmentIds()).toContain(ENV_ID)
    })

    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: ENV_ID, type: 'environment' })

    // No leaked spinner: the env is no longer reported as resolving...
    expect(contextService.getResolvingEnvironmentIds()).not.toContain(ENV_ID)
    // ...and the cancelled fetch never populated the cache (the 5s sleep was
    // aborted, so it never returned its value).
    expect(secretHydrationService.peekResolved('slowTest', SLOW_PARAMS)).toBeUndefined()
  })

  it('clearAll() (file close) aborts in-flight hydrations and clears resolving state', async () => {
    openEnvWithSlowSecret()
    await vi.waitFor(() => {
      expect(contextService.getResolvingEnvironmentIds()).toContain(ENV_ID)
    })

    contextService.clearAll()

    expect(contextService.getResolvingEnvironmentIds()).toEqual([])
    expect(secretHydrationService.peekResolved('slowTest', SLOW_PARAMS)).toBeUndefined()
  })
})

/**
 * A secret owned by a PARENT env must be resolved once and INHERITED by a child
 * sub-env through context — the child must NOT re-resolve (re-fetch) it under
 * its own cache scope. The regression: hydrating a child collected the whole
 * ancestor chain's secrets, so a child with no secrets of its own re-ran the
 * parent's slow secret (a second loading), and the per-scope cache never hit.
 */
describe('nested env-folder secret inheritance (child does not re-fetch the parent secret)', () => {
  const PARENT_ID = 'env-nested-parent'
  const CHILD_ID = 'env-nested-child'
  const ENV_NAME = 'RESTORM_NESTED_SECRET'

  beforeEach(() => {
    contextService.initialize() // idempotent
    registerBuiltinSources() // idempotent
    process.env[ENV_NAME] = 'nested-secret-value'
    secretHydrationService.clearScope(PARENT_ID)
    secretHydrationService.clearScope(CHILD_ID)
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, ENV_NAME)
    secretHydrationService.clearScope(PARENT_ID)
    secretHydrationService.clearScope(CHILD_ID)
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: CHILD_ID, type: 'environment' })
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_DELETED, { id: PARENT_ID, type: 'environment' })
  })

  it('a child sub-env inherits the parent secret via context without hydrating it itself', async () => {
    // Parent OWNS the secret; child (sub-env) owns nothing but composes it.
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
      id: PARENT_ID,
      type: 'environment',
      parentEnvironmentId: null,
      document: {
        id: PARENT_ID,
        name: 'parent',
        variables: [new KeyValue({ key: 'apiKey', value: new SecretValue('envVar', { name: ENV_NAME }) })]
      }
    })
    void testEventBus.emit(DocumentEvents.ENVIRONMENT_CREATED, {
      id: CHILD_ID,
      type: 'environment',
      parentEnvironmentId: PARENT_ID,
      document: {
        id: CHILD_ID,
        name: 'child',
        variables: [new KeyValue({ key: 'header', value: new ExpressionValue('Bearer {{apiKey}}') })]
      }
    })

    // The parent resolves the secret, and the child inherits it (the secret AND
    // an expression composing it) purely through context inheritance.
    await vi.waitFor(() => {
      expect(contextService.getContext(CHILD_ID)?.apiKey).toBe('nested-secret-value')
      expect(contextService.getContext(CHILD_ID)?.header).toBe('Bearer nested-secret-value')
    })

    // The child has no secret of its own, so it never enters the resolving set —
    // it does not re-fetch the inherited credential.
    expect(contextService.getResolvingEnvironmentIds()).not.toContain(CHILD_ID)
  })
})
