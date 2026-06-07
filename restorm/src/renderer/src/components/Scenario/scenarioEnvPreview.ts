import { setEnvironmentPreviewResolver, concreteValue } from '../../../../shared/utils/scenarioStaticPreview'
import { useRestormStore } from '../../store/restormStore'
import { collectAllEnvironments } from '../../hooks/collectAllEnvironments'

/**
 * Registers a renderer-side resolver so the inspector's static preview renders
 * an `environment` operand as `{ name, variables }` — mirroring the runtime
 * (`conditionEval.resolveOperand`) instead of the opaque `{{$id}}` template.
 *
 * Side-effect on import (idempotent reassignment). Imported once by the
 * scenario editor. Reads the live env store on every call, so it tracks
 * env-folder edits without re-registering.
 *
 * Value fidelity: `variables` are the environment's variable values resolved by
 * `concreteValue` — exact for plain values (the common case); an env variable
 * that is itself an `expression` shows its template rather than the
 * runtime-resolved string (acceptable for the inspector's "example data").
 */
setEnvironmentPreviewResolver((envId: string): unknown => {
  const collections = useRestormStore.getState().collections
  const env = collectAllEnvironments(collections).find((r) => r.env.id === envId)?.env
  if (!env) return undefined
  const variables: Record<string, unknown> = {}
  for (const kv of env.variables) {
    if (typeof kv.key === 'string' && kv.key.length > 0) variables[kv.key] = concreteValue(kv.value)
  }
  // Omit `variables` entirely for an env with none — an empty `{}` rendered a
  // misleading expandable-but-empty node in the run log (mirrors the runtime
  // `conditionEval.resolveOperand`).
  return Object.keys(variables).length > 0 ? { name: env.name, variables } : { name: env.name }
})
