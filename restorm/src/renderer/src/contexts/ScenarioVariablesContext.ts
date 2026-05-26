import { createContext, useContext } from 'react'
import type { ValueTypeKind } from '../components/TypedValueField/castValue'

/** A variable in scope for the current scenario, with the type it was declared
 * with (the value type of its `setVariable` / `input` node). The type lets the
 * value selector hide variables whose type a given slot doesn't accept (e.g. a
 * string variable is not offered to an arithmetic operand). */
export interface ScenarioVariable {
  name: string
  type: ValueTypeKind
}

/**
 * Variables in scope for the current scenario — declared by `setVariable` nodes
 * (and named `input`/param nodes). Provided by the scenario editor and consumed
 * by the value selector ({@link TypedValueField}) to populate its "Variables"
 * menu. Empty (the default) outside a scenario, e.g. in a request's KV table, so
 * the menu entry simply doesn't appear there.
 */
export const ScenarioVariablesContext = createContext<ScenarioVariable[]>([])

export function useScenarioVariables(): ScenarioVariable[] {
  return useContext(ScenarioVariablesContext)
}
