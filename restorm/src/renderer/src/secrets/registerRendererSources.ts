import { valueSourceRegistry } from '../../../shared/secrets/valueSourceRegistry'
import { envVarDescriptor } from '../../../shared/secrets/sources/envVar.descriptor'
import { envFileSecretDescriptor } from '../../../shared/secrets/sources/envFileSecret.descriptor'

/**
 * Register the shared value-source DESCRIPTORS into the renderer's copy of the
 * `valueSourceRegistry`.
 *
 * `valueSourceRegistry` is a module-level singleton, but the main and renderer
 * processes are separate bundles, so each owns an independent (initially empty)
 * registry instance. The main process registers descriptors AND resolvers at
 * boot; the renderer must register only the descriptors here so the type-pick
 * menu (and the per-source config UI) can enumerate the available sources.
 *
 * Resolvers are deliberately NOT registered here — resolution runs main-side
 * only, where it can touch the environment / files / network. The renderer only
 * needs the renderer-safe descriptor metadata (labels, param schema, config
 * component id).
 *
 * Idempotent: `register` overwrites by id, so calling this more than once is
 * harmless.
 */
export function registerRendererSources(): void {
  valueSourceRegistry.register(envFileSecretDescriptor)
  valueSourceRegistry.register(envVarDescriptor)
}
