/**
 * Suite-local test instance: the shared MCP fixture, extended with this
 * suite's OWN service containers (worker-scoped, ephemeral ports).
 */
import { test as base, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/mcp-server.fixture'
import { servicesWorkerFixture, type StartedServices } from '../../../helpers/testcontainers/services'

export const test = base.extend<object, { services: StartedServices }>({
  services: servicesWorkerFixture(['grpc', 'grpcweb-mock', 'connect-mock'])
})

export { expect }
export type { McpDiscovery, McpToolReply }
