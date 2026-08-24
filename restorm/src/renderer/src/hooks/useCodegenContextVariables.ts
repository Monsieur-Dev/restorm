import { useMemo } from 'react'
import type { VariableDefinition } from 'electron-core-ui/renderer'
import type { ApiDesign, DesignModel, DesignRoute, DesignRouteGroup } from '../../../shared/types/collections'
import { codegenEvalContext } from '../../../shared/design/codegenContext'
import { flattenToVariableDefinitions } from '../components/Design/codegenContextVariables'
import { useDesignEnvVariables } from './useDesignEnvVariables'

/**
 * The contextual variables the code-generation value editor offers for one
 * entity scope: the flattened codegen eval-context (`design.*`, `model.*` or
 * `group.* / route.*` — exactly what the expression is evaluated against at
 * generate time) MERGED with the design's environment variables. Memoised on a
 * content signature so the identity only flips on a real change — the
 * `RestormVariableInputBox` re-inits Monaco (stealing focus) on a new
 * `variables` reference.
 */
export function useCodegenContextVariables(
  design: ApiDesign,
  entity: { model?: DesignModel; group?: DesignRouteGroup; route?: DesignRoute }
): VariableDefinition[] {
  const envVars = useDesignEnvVariables(design.id)
  const contextVars = flattenToVariableDefinitions(codegenEvalContext(design, entity))
  const combined = [...contextVars, ...envVars]
  const signature = JSON.stringify(combined)
  return useMemo(() => JSON.parse(signature) as VariableDefinition[], [signature])
}
