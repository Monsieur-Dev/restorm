import type { ApiDesign, Environment } from '../../../../shared/types/collections'
import { resolveUrlAgainstEnv, flattenEnvVars, coerceEnvVarValue } from '../../../../shared/utils/resolveUrlAgainstEnv'

/** The raw variable map of one environment — same value coercion as the
 * documentation matcher's `envVarsFromFolder`. */
export function envVarsFromEnvironment(env: Environment | undefined): Record<string, string> {
  if (!env) return {}
  const out: Record<string, string> = {}
  for (const kv of env.variables) {
    const coerced = coerceEnvVarValue(kv.value)
    if (coerced !== undefined) out[kv.key] = coerced
  }
  return out
}

/** Flattened `{{variable}}` map for one environment (helpers + nested
 * resolution), ready to feed {@link resolveServedDesign}. */
export function servedEnvVars(env: Environment | undefined): Record<string, string> {
  return flattenEnvVars(envVarsFromEnvironment(env))
}

/**
 * A JSON-safe snapshot of the design with its serve-config `{{variable}}`
 * expressions RESOLVED — the base path and the port become literals before
 * the main-side server (which has no env-folder context) consumes them.
 * An unresolved / invalid port is dropped so main falls back to its
 * default. Everything else rides through untouched.
 */
export function resolveServedDesign(design: ApiDesign, envVars: Record<string, string>): ApiDesign {
  const snapshot = JSON.parse(JSON.stringify(design)) as ApiDesign
  if (snapshot.server?.basePath !== undefined && snapshot.server.basePath !== '') {
    snapshot.server.basePath = resolveUrlAgainstEnv(snapshot.server.basePath, envVars)
  }
  const rawPort = snapshot.serving?.port
  if (snapshot.serving !== undefined && rawPort !== undefined) {
    const resolved = typeof rawPort === 'string' ? resolveUrlAgainstEnv(rawPort, envVars) : String(rawPort)
    const n = Number.parseInt(resolved, 10)
    if (Number.isFinite(n) && n > 0 && n <= 65535) snapshot.serving.port = n
    else delete snapshot.serving.port
  }
  return snapshot
}
