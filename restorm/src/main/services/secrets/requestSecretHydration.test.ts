import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The real ContextService logs through electron-core-ui's LoggerService,
// which reads `app.isPackaged` at first log. Provide a minimal Electron
// stub so the logger initializes under the jsdom test runner.
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getName: () => 'restorm', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { contextService } = await import('../ContextService')
const { secretHydrationService } = await import('./SecretHydrationService')
const { registerBuiltinSources } = await import('./mainSourceRegistry')
const { collectRequestSecrets } = await import('./collectRequestSecrets')
const { KeyValue } = await import('../../../shared/models/KeyValue')
const { SecretValue } = await import('../../../shared/types/valueTypes/SecretValue')

/**
 * Integration-style coverage of the run-time secret seam: a request
 * header whose value is a `SecretValue('envVar', { name })` must
 * resolve to the live env var AFTER hydration, and stay empty WITHOUT
 * it. Exercises the real ContextService sync resolve path
 * (`resolveKeyValueForRequest`) plus the real SecretHydrationService +
 * the registered EnvVar resolver — i.e. the same wiring
 * `HTTPExecutionService.execute` drives before dispatch. The request's
 * KeyValue groups are built directly (mirroring
 * `RequestContext.keyValueGroups`) so the test never enters the
 * Electron-bound `registerRequest` path.
 */
describe('request secret hydration seam', () => {
  const REQUEST_ID = 'secret-seam-req'
  const ENV_NAME = 'RESTORM_SECRET_SEAM_TOKEN'

  beforeEach(() => {
    registerBuiltinSources() // idempotent
    process.env[ENV_NAME] = 'super-secret-value'
    secretHydrationService.clearScope(REQUEST_ID)
  })

  afterEach(() => {
    Reflect.deleteProperty(process.env, ENV_NAME)
    secretHydrationService.clearScope(REQUEST_ID)
  })

  function secretHeader(): InstanceType<typeof KeyValue> {
    return new KeyValue({ key: 'X-Token', value: new SecretValue('envVar', { name: ENV_NAME }) })
  }

  function groupsFor(...headers: InstanceType<typeof KeyValue>[]): Map<string, InstanceType<typeof KeyValue>[]> {
    return new Map([['headers', headers]])
  }

  it('collects the SecretValue from the request key-value groups', () => {
    const secrets = collectRequestSecrets(groupsFor(secretHeader()))
    expect(secrets).toHaveLength(1)
    expect(secrets[0]).toBeInstanceOf(SecretValue)
    expect(secrets[0].source).toBe('envVar')
  })

  it('resolves the header to the live env var after hydration', async () => {
    const header = secretHeader()
    const secrets = collectRequestSecrets(groupsFor(header))

    await secretHydrationService.hydrate(REQUEST_ID, secrets)

    // No registered context for REQUEST_ID → resolveKeyValueForRequest
    // takes the no-env shortcut and returns value.toString(), which for a
    // hydrated SecretValue is the resolved plaintext.
    expect(contextService.resolveKeyValueForRequest(header, REQUEST_ID)).toBe('super-secret-value')
  })

  it('resolves to empty without hydration', () => {
    const header = secretHeader()
    // No hydration call: SecretValue.resolved stays undefined.
    expect(contextService.resolveKeyValueForRequest(header, REQUEST_ID)).toBe('')
  })

  it('skips disabled rows when collecting', () => {
    const enabled = secretHeader()
    const disabled = new KeyValue({ key: 'B', value: new SecretValue('envVar', { name: ENV_NAME }), enabled: false })
    expect(collectRequestSecrets(groupsFor(enabled, disabled))).toHaveLength(1)
  })
})
