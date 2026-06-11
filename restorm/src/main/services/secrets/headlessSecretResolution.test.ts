import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Minimal Electron stub — same pattern as requestSecretHydration.test.ts.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getName: () => 'restorm', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { secretHydrationService } = await import('./SecretHydrationService')
const { registerBuiltinSources } = await import('./mainSourceRegistry')
const { collectRequestSecrets } = await import('./collectRequestSecrets')
const { contextService } = await import('../ContextService')
const { KeyValue } = await import('../../../shared/models/KeyValue')
const { SecretValue } = await import('../../../shared/types/valueTypes/SecretValue')

/**
 * Headless CLI path — secret resolution via EnvVar source.
 *
 * The headless runner (src/main/cli/headlessRunner.ts) executes scenarios
 * through the scenario engine, which calls the execution services (HTTP,
 * SOAP, GraphQL, WebSocket, gRPC). Those services now call
 * `secretHydrationService.hydrate` before the synchronous
 * `resolveKeyValueForRequest` loop, mirroring the interactive-UI path.
 *
 * `registerBuiltinSources()` is called unconditionally in
 * `src/main/index.ts` (the single entry point for both interactive and
 * headless modes) before the `cliArgs.cliRun` block — so sources are
 * always registered regardless of whether a window is created.
 *
 * These tests prove the hydrate→resolve flow that the execution services
 * rely on, using the same helpers the services use at runtime.
 */
describe('headless EnvVar secret resolution', () => {
  const REQUEST_ID = 'headless-secret-test-req'
  const ENV_NAME = 'RESTORM_HEADLESS_TEST_TOKEN'

  beforeEach(() => {
    // registerBuiltinSources is idempotent — same call that index.ts makes
    // unconditionally at boot (before the headless run block).
    registerBuiltinSources()
    process.env[ENV_NAME] = 'headless-resolved-value'
    secretHydrationService.clearScope(REQUEST_ID)
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, ENV_NAME)
    secretHydrationService.clearScope(REQUEST_ID)
  })

  it('registerBuiltinSources is idempotent (safe to call on every boot)', () => {
    // Calling multiple times must not throw or corrupt state.
    expect(() => {
      registerBuiltinSources()
      registerBuiltinSources()
    }).not.toThrow()
  })

  it('resolves an EnvVar SecretValue header in the headless hydrate→resolve path', async () => {
    const header = new KeyValue({ key: 'Authorization', value: new SecretValue('envVar', { name: ENV_NAME }) })
    const groups = new Map([['headers', [header]]])

    // Step that execution services perform before resolveKeyValueForRequest.
    const secrets = collectRequestSecrets(groups)
    expect(secrets).toHaveLength(1)
    await secretHydrationService.hydrate(REQUEST_ID, secrets)

    // Mirrors what resolveKeyValueForRequest returns after hydration.
    expect(contextService.resolveKeyValueForRequest(header, REQUEST_ID)).toBe('headless-resolved-value')
  })

  it('returns empty string without hydration (confirms hydration is required)', () => {
    const header = new KeyValue({ key: 'Authorization', value: new SecretValue('envVar', { name: ENV_NAME }) })
    expect(contextService.resolveKeyValueForRequest(header, REQUEST_ID)).toBe('')
  })

  it('multiple secret headers all resolve after a single hydrate call', async () => {
    const tokenEnv = ENV_NAME
    const keyEnv = 'RESTORM_HEADLESS_TEST_KEY'
    process.env[keyEnv] = 'my-api-key'

    try {
      const authHeader = new KeyValue({ key: 'Authorization', value: new SecretValue('envVar', { name: tokenEnv }) })
      const keyHeader = new KeyValue({ key: 'X-Api-Key', value: new SecretValue('envVar', { name: keyEnv }) })
      const groups = new Map([['headers', [authHeader, keyHeader]]])

      const secrets = collectRequestSecrets(groups)
      expect(secrets).toHaveLength(2)
      await secretHydrationService.hydrate(REQUEST_ID, secrets)

      expect(contextService.resolveKeyValueForRequest(authHeader, REQUEST_ID)).toBe('headless-resolved-value')
      expect(contextService.resolveKeyValueForRequest(keyHeader, REQUEST_ID)).toBe('my-api-key')
    } finally {
      Reflect.deleteProperty(process.env, keyEnv)
    }
  })
})
