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
