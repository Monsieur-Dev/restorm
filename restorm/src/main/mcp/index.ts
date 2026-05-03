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
import { registerResources } from './resources'

export function registerRestormMcp(mcp: McpService): void {
  registerActiveStateBridge()
  registerReadTools(mcp)
  registerNavigationTools(mcp)
  registerResources(mcp)
}
