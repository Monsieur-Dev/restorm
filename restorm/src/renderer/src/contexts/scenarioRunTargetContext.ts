import { createContext, useContext } from 'react'

/** App-level info the scenario inspector's CLI-command help needs (it renders
 * deep in the tree, away from the project state). */
export interface ScenarioCliInfo {
  /** Returns the SHORTEST unambiguous `--run` value for a scenario id (bare
   * name, breadcrumb, or index path), or null. */
  suggestRunTarget: (scenarioId: string) => string | null
  /** The open project's file/folder path, for the `--open` argument, or null
   * when nothing is open. */
  projectPath: string | null
}

const ScenarioCliInfoContext = createContext<ScenarioCliInfo | null>(null)

export const ScenarioCliInfoProvider = ScenarioCliInfoContext.Provider

export function useScenarioCliInfo(): ScenarioCliInfo | null {
  return useContext(ScenarioCliInfoContext)
}
