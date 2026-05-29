/**
 * Entry point for restorm-domain MCP tools + resources. Called once at
 * boot from `restorm/src/main/index.ts` after `McpService.start()`.
 *
 * Tool / resource handlers reach into restorm's services at call time
 * (no closures over project state) so they always see the freshest
 * `CollectionStore` / `ContextService` / `FileService` view, even after
 * the user opens a different project.
 */

import { McpService } from 'electron-core-ui'
import { registerActiveStateBridge } from './tools/activeState'
import { registerReadTools } from './tools/read'
import { registerNavigationTools } from './tools/navigation'
import { registerProjectTools } from './tools/project'
import { registerWriteTools } from './tools/write'
import { registerImportTools } from './tools/import'
import { registerExecutionTools } from './tools/execute'
import { registerWorkbenchTabTools } from './tools/workbenchTabs'
import { registerScenarioTools } from './tools/scenario'
import { registerScenarioRunTools } from './tools/scenarioRun'
import { installScenarioEngineIPC } from '../scenarioEngine/ipcBridge'
import { registerResources } from './resources'

export function registerRestormMcp(mcp: McpService): void {
  registerActiveStateBridge()
  registerReadTools(mcp)
  registerNavigationTools(mcp)
  registerProjectTools(mcp)
  registerWriteTools(mcp)
  registerImportTools(mcp)
  registerExecutionTools(mcp)
  registerWorkbenchTabTools(mcp)
  registerScenarioTools(mcp)
  registerScenarioRunTools(mcp)
  installScenarioEngineIPC()
  registerResources(mcp)
}
