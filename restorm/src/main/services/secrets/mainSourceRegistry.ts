import { valueSourceRegistry } from '../../../shared/secrets/valueSourceRegistry'
import type { ValueSourceResolver } from '../../../shared/secrets/ValueSource'
import { envVarDescriptor } from '../../../shared/secrets/sources/envVar.descriptor'
import { envFileSecretDescriptor } from '../../../shared/secrets/sources/envFileSecret.descriptor'
import { envVarResolver } from './resolvers/envVar.resolver'
import { envFileSecretResolver } from './resolvers/envFileSecret.resolver'

// Private map of main-process resolvers (not sent to renderer).
const resolvers = new Map<string, ValueSourceResolver>()

/**
 * Register all built-in value sources.
 *
 * Idempotent — safe to call multiple times (e.g. in tests).
 */
export function registerBuiltinSources(): void {
  valueSourceRegistry.register(envVarDescriptor)
  resolvers.set(envVarResolver.id, envVarResolver)

  valueSourceRegistry.register(envFileSecretDescriptor)
  resolvers.set(envFileSecretResolver.id, envFileSecretResolver)
}

export function getResolver(id: string): ValueSourceResolver | undefined {
  return resolvers.get(id)
}

/**
 * TEST-ONLY: register an extra resolver into the main registry (e.g. a slow,
 * abort-honouring stub used to exercise hydration cancellation). Guarded to the
 * test runner so a production caller can't inject a resolver via this hook.
 */
export function registerResolverForTests(resolver: ValueSourceResolver): void {
  if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] === undefined) {
    throw new Error('registerResolverForTests is test-only and must not be called in production')
  }
  resolvers.set(resolver.id, resolver)
}
