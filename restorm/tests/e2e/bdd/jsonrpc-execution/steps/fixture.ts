/**
 * Suite-local test instance: the shared MCP fixture, extended with this
 * suite's OWN jsonrpc mock container (worker-scoped, ephemeral port).
 */
import { test as base, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'
import { servicesWorkerFixture, type StartedServices } from '../../../helpers/testcontainers/services'

export const test = base.extend<object, { services: StartedServices }>({
  services: servicesWorkerFixture(['jsonrpc'])
})

export { expect }
export type { McpDiscovery, McpToolReply }
