// Default per-kind ports moved to `shared` so the main-process MCP tools can
// stamp the same ports as the editor. Re-exported here to keep existing
// renderer imports stable.
export { defaultPortsForKind, isValidScenarioConnection, outputPortFlow, inputPortFlow, canConnectFlow, deriveRunScenarioPorts } from '../../../../shared/scenarioNodePorts'
