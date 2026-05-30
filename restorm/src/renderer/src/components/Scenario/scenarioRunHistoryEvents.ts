/** Local event bridging the scenario tab-header run-history button to the
 * editor that hosts the (tab-scoped) run-history overlay. */
export const SCENARIO_RUN_HISTORY_OPEN = 'scenario:run-history:open'

export interface ScenarioRunHistoryOpenPayload {
  scenarioId: string
}
