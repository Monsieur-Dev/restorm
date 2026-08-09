/**
 * Suite-local test instance: the shared run-log fixture, extended with this
 * suite's OWN service containers (worker-scoped, ephemeral ports).
 */
import { test as base, expect } from '../../fixtures/scenario-runlog.fixture'
import { servicesWorkerFixture, type StartedServices } from '../../../helpers/testcontainers/services'

export const test = base.extend<object, { services: StartedServices }>({
  services: servicesWorkerFixture(['petstore', 'auth-service', 'rabbitmq', 'activemq', 'redis', 'jsonrpc', 'trpc', 'sse-server', 'grpc', 'grpcweb-mock', 'kafka'])
})

export { expect }
