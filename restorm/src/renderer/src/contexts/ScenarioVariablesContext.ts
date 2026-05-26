import { createContext, useContext } from 'react'

/**
 * Names of the variables in scope for the current scenario — declared by
 * `setVariable` nodes (and named `input`/param nodes). Provided by the scenario
 * editor and consumed by the value selector ({@link TypedValueField}) to
 * populate its "Variables" menu. Empty (the default) outside a scenario, e.g.
 * in a request's KV table, so the menu entry simply doesn't appear there.
 */
export const ScenarioVariablesContext = createContext<string[]>([])

export function useScenarioVariables(): string[] {
  return useContext(ScenarioVariablesContext)
}
