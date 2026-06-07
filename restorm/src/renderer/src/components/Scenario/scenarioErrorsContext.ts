import { createContext, useContext } from 'react'
import type { ScenarioNodeError } from '../../../../shared/scenarioValidation'

/**
 * Per-node validation errors for the open scenario, keyed by node id. Computed
 * once in the editor (it has the whole graph) and read by each box via
 * {@link useScenarioNodeErrors}, so a box paints its red border + disables its
 * play button without the editor having to mutate every node's data.
 */
export const ScenarioErrorsContext = createContext<ReadonlyMap<string, ScenarioNodeError[]>>(new Map())

const NONE: ScenarioNodeError[] = []

/** The validation errors for one box (empty when the box is valid). */
export function useScenarioNodeErrors(nodeId: string): ScenarioNodeError[] {
  return useContext(ScenarioErrorsContext).get(nodeId) ?? NONE
}

/** Whether a given field/control of a box is flagged by one of its errors —
 * lets a per-kind box outline that control (e.g. the name input) in red. */
export function useScenarioFieldInvalid(nodeId: string, field: string): boolean {
  return useScenarioNodeErrors(nodeId).some((e) => e.field === field)
}
