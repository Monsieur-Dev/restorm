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
import { registerInstanceLifecycleTools, type InstanceLifecycleHost } from './tools/instances'
import { registerActiveStateBridge } from './tools/activeState'
import { registerFavoritesBridge } from './favoritesBridge'
import { registerReadTools } from './tools/read'
import { registerNavigationTools } from './tools/navigation'
import { registerProjectTools } from './tools/project'
import { registerWriteTools } from './tools/write'
import { registerCookieTools } from './tools/cookies'
import { registerDesignTools } from './tools/design'
import { registerQuickConfigTools } from './tools/quickConfig'
import { registerImportTools } from './tools/import'
import { registerExecutionTools } from './tools/execute'
import { registerWorkbenchTabTools } from './tools/workbenchTabs'
import { registerWorkbenchLayoutTools } from './tools/workbenchLayout'
import { registerScenarioTools } from './tools/scenario'
import { registerScenarioRunTools } from './tools/scenarioRun'
import { registerScenarioEngineTools } from './tools/scenarioEngineTools'
import { installScenarioEngineIPC } from '../scenarioEngine/ipcBridge'
import { registerResources } from './resources'
import { registerGitTools } from './tools/git'
import { registerRecordingTools } from './tools/recording'
import { createMcpProGate } from './mcpProGate'
import { getEntitlementService, resolveBackendVersion } from '../services/auth/authComposition'
import { hasCapability } from '../../shared/auth/authState'
import { resolveChannel } from '../../shared/config/backend'
import { pricingUrl } from '../../shared/config/site'

export function registerRestormMcp(mcp: McpService, instanceHost: InstanceLifecycleHost): void {
  registerActiveStateBridge()
  // Per-tool capability gate: the request-driving tools stay free, the
  // advanced tools (scenarios, capture, UI automation, multi-instance)
  // require `mcp.pro`, and the git routes require `git.client` — see
  // `mcpProGate.ts`'s `TOOL_CAPABILITY` map for which tool needs which. Each
  // tool's specific capability is read lazily on every call (the
  // EntitlementService is initialized before any tool can run, and the
  // entitlement flips live on login/logout/refresh). The refusal's upgrade
  // URL is channel-resolved (dev site on preview builds, restorm.app on
  // release) from the same `pricingUrl` source the renderer's upsell link
  // uses.
  mcp.setToolGate(
    createMcpProGate({
      hasCapability: (capability) => {
        // Fail closed to community if the entitlement service isn't ready (never
        // let a gate read crash a tool call); in production it's initialized at
        // boot before any tool can run.
        try {
          return hasCapability(getEntitlementService().getState(), capability)
        } catch {
          return false
        }
      },
      pricingUrl: pricingUrl(resolveChannel(resolveBackendVersion()))
    })
  )
  registerInstanceLifecycleTools(mcp, instanceHost)
  registerFavoritesBridge()
  registerReadTools(mcp)
  registerNavigationTools(mcp)
  registerProjectTools(mcp)
  registerWriteTools(mcp)
  registerDesignTools(mcp)
  registerQuickConfigTools(mcp)
  registerImportTools(mcp)
  registerExecutionTools(mcp)
  registerCookieTools(mcp)
  registerWorkbenchTabTools(mcp)
  registerWorkbenchLayoutTools(mcp)
  registerScenarioTools(mcp)
  registerScenarioRunTools(mcp)
  registerScenarioEngineTools(mcp)
  registerGitTools(mcp)
  registerRecordingTools(mcp)
  installScenarioEngineIPC()
  registerResources(mcp)
}
