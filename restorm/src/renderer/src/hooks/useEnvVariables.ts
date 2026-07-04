import { useAvailableVariables } from './useAvailableVariables'
import type { VariableDefinition } from '../contexts/availableVariablesContextValue'

/**
 * Hook to get the environment / env-folder variables available to a request,
 * independent of any per-field cumulative context.
 *
 * Scalar Handlebars inputs that are not the URL field (procedure, topic,
 * routing key, auth, ...) use this to feed their `{{...}}` autocomplete so the
 * environment variables surface alongside the helper functions, for every
 * protocol. The backend broadcasts this list under the `${requestId}:env`
 * field id.
 *
 * @param requestId - The request whose environment variables are wanted
 * @returns Array of environment variables, updated when they change
 */
export function useEnvVariables(requestId: string | undefined): VariableDefinition[] {
  return useAvailableVariables(requestId ? `${requestId}:env` : undefined)
}
