import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Minimal Electron stub — same pattern as headlessSecretResolution.test.ts.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getName: () => 'restorm', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { secretHydrationService } = await import('../../services/secrets/SecretHydrationService')
const { registerBuiltinSources } = await import('../../services/secrets/mainSourceRegistry')
const { collectConfigSecrets } = await import('../../services/secrets/collectConfigSecrets')
const { setVariableExecutor, assertExecutor } = await import('./pureExecutors')
const { setSecretPreviewResolver } = await import('../../../shared/utils/scenarioStaticPreview')
const { resolveOperand } = await import('../conditionEval')

type Activation = import('../types').Activation
type ExecContext = import('../types').ExecContext
type ExecResult = import('../types').ExecResult

/** A no-input activation for a pure executor (only `inputs` matters here). */
function activation(nodeId: string, kind: string): Activation {
  return { nodeId, kind: kind as Activation['kind'], scope: [], inputs: {} }
}

/** A minimal ExecContext carrying just the node config + variable store the
 * pure executors under test read (the rest is never touched by them). */
function execContext(config: Record<string, unknown>, variables: Map<string, unknown>): ExecContext {
  return { node: { config } as ExecContext['node'], variables } as unknown as ExecContext
}

/**
 * The scenario engine must resolve a `SecretValue` operand to its real
 * plaintext at run time. The renderer registers its own async-cache resolver;
 * the main-process engine wires `secretPreviewResolver` to the hydration
 * cache's synchronous `peekResolved`. The scheduler hydrates a node's secrets
 * before the executor runs, so by the time `resolveOperand` → `concreteValue`
 * reaches the `secret` case the plaintext is cached.
 *
 * These tests exercise that seam directly (no full scheduler): hydrate the
 * config's secrets, then run the pure executors that read them.
 */
describe('scenario engine — SecretValue operand resolution', () => {
  const SCOPE = 'secret-operand-test-run'
  const ENV_NAME = 'RESTORM_SECRET_OPERAND_TEST'
  const PLAINTEXT = 's3cr3t-operand-value'

  beforeEach(() => {
    registerBuiltinSources()
    process.env[ENV_NAME] = PLAINTEXT
    secretHydrationService.clearScope(SCOPE)
    setSecretPreviewResolver((source, params) => secretHydrationService.peekResolved(source, params))
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, ENV_NAME)
    secretHydrationService.clearScope(SCOPE)
    setSecretPreviewResolver(null)
  })

  it('resolves a secret operand to empty string WITHOUT hydration (the bug)', () => {
    const secretCfg = { type: 'secret', source: 'envVar', params: { name: ENV_NAME } }
    // No hydrate call → the cache is empty → the resolver misses → ''.
    expect(resolveOperand(undefined, secretCfg)).toBe('')
  })

  it('resolves a secret operand to the real plaintext AFTER hydration', async () => {
    const secretCfg = { type: 'secret', source: 'envVar', params: { name: ENV_NAME } }
    await secretHydrationService.hydrate(SCOPE, collectConfigSecrets(secretCfg))
    expect(resolveOperand(undefined, secretCfg)).toBe(PLAINTEXT)
  })

  it('setVariable stores the resolved plaintext, and assert compares it equal', async () => {
    const variables = new Map<string, unknown>()
    const setCfg = { name: 'apiKey', value: { type: 'secret', source: 'envVar', params: { name: ENV_NAME } } }
    await secretHydrationService.hydrate(SCOPE, collectConfigSecrets(setCfg))

    // setVariable resolves its inline secret value and writes it to the run store.
    void setVariableExecutor(activation('set', 'setVariable'), execContext(setCfg, variables))
    expect(variables.get('apiKey')).toBe(PLAINTEXT)

    // assert compares the stored variable (left) against the expected plaintext
    // (right) — the pass branch must fire (`then`), proving the secret resolved.
    const assertCfg = {
      operator: 'eq',
      left: { type: 'variable', value: 'apiKey' },
      right: { type: 'string', value: PLAINTEXT }
    }
    const result = assertExecutor(activation('assert', 'assert'), execContext(assertCfg, variables)) as ExecResult
    expect(result.outputs[0]?.port).toBe('then')
  })
})
