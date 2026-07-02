/**
 * Docker setup utilities for integration tests
 */

import { execSync } from 'child_process'
import { join } from 'path'

const DOCKER_COMPOSE_PATH = join(__dirname, '../docker/docker-compose.yml')

/** Service health check configuration */
interface ServiceCheck {
  name: string
  url: string
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
  expectedStatus?: number
  retries?: number
}

/** Available services from docker-compose */
export const SERVICES = {
  petstore: {
    name: 'Petstore (HTTP/REST)',
    baseUrl: 'http://localhost:8080',
    apiPath: '/api',
    swaggerUrl: 'http://localhost:8080/api/openapi.json'
  },
  petstoreOpenApi3: {
    name: 'Petstore (OpenAPI 3.0)',
    baseUrl: 'http://localhost:8081',
    /** OpenAPI 3.0 spec URL — used by integration tests to validate
     * URL-based spec fetch + content-sniff routing. Runtime endpoints
     * under `/v3/*` require auth and are NOT exercised here; runtime
     * tests stay on the swaggerapi/petstore mock above. */
    openapiUrl: 'http://localhost:8081/openapi.json'
  },
  graphql: {
    name: 'GraphQL Server',
    baseUrl: 'http://localhost:4000'
  },
  httpUtil: {
    name: 'HTTP Utility Mock',
    baseUrl: 'http://localhost:8082'
  },
  odataV2: {
    name: 'OData v2 PetStore Mock',
    baseUrl: 'http://localhost:5102'
  },
  soap: {
    /** Castle Mock — kept for manual local testing; E2E suite uses soapServer below. */
    name: 'SOAP Server (Castle Mock)',
    baseUrl: 'http://localhost:8090'
  },
  soapServer: {
    /** Zero-dependency SOAP mock used by the soap-execution E2E suite. */
    name: 'SOAP mock server',
    baseUrl: 'http://localhost:8091'
  },
  grpc: {
    name: 'gRPC Server (grpcbin)',
    host: 'localhost:9000',
    // :9002 is the dedicated gRPC-Web mock (`grpcweb-server`), not another
    // grpcbin port — grpcbin itself doesn't speak gRPC-Web on any port.
    webHost: 'localhost:9002'
  },
  mqtt: {
    name: 'MQTT Broker (Mosquitto)',
    host: 'localhost:1883',
    wsHost: 'localhost:9001'
  },
  gitServer: {
    /** Unauthenticated `git daemon` — see tests/integration/gitServerSeed.ts
     * for the seeded repo + clone URL. */
    name: 'Git server (git daemon)',
    host: 'localhost:9418'
  }
} as const

/** Check if Docker is available */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'ignore' })
    execSync('docker compose version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Start Docker containers */
export function startDocker(): void {
  console.log('Starting Docker containers...')
  try {
    // --wait makes compose block until every container with a healthcheck
    // reports healthy (not just "started"). This prevents a race where the
    // e2e suite begins before soap-server (or other fast-starting services)
    // are actually ready to serve requests.
    execSync(`docker compose -f "${DOCKER_COMPOSE_PATH}" up -d --wait`, {
      stdio: 'inherit',
      timeout: 120000
    })
  } catch (error) {
    throw new Error(`Failed to start Docker containers: ${String(error)}`)
  }
}

/** Stop Docker containers */
export function stopDocker(): void {
  console.log('Stopping Docker containers...')
  try {
    execSync(`docker compose -f "${DOCKER_COMPOSE_PATH}" down`, {
      stdio: 'inherit',
      timeout: 60000
    })
  } catch {
    // Ignore errors when stopping
  }
}

/** Wait for a service to be ready */
async function waitForService(check: ServiceCheck): Promise<boolean> {
  const maxRetries = check.retries ?? 30
  const delay = 2000 // 2 seconds between retries

  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => { controller.abort(); }, 5000)

      const response = await fetch(check.url, {
        method: check.method ?? 'GET',
        headers: check.headers,
        body: check.body,
        signal: controller.signal
      })

      clearTimeout(timeout)

      const expectedStatus = check.expectedStatus ?? 200
      if (response.status === expectedStatus || response.ok) {
        console.log(`✓ ${check.name} is ready`)
        return true
      }
    } catch {
      // Service not ready yet
    }

    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  console.log(`✗ ${check.name} failed to start`)
  return false
}

/** Wait for all services to be ready */
export async function waitForServices(): Promise<void> {
  console.log('Waiting for services to be ready...')

  const checks: ServiceCheck[] = [
    {
      name: 'Petstore',
      url: `${SERVICES.petstore.baseUrl}/api/pet/findByStatus?status=available`
    },
    {
      name: 'GraphQL',
      url: SERVICES.graphql.baseUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' })
    },
    {
      name: 'HTTP Utility Mock',
      url: `${SERVICES.httpUtil.baseUrl}/health`
    },
    {
      // The E2E suite targets the soap-server mock (:8091), not Castle Mock.
      // soap-server is a zero-dependency node:http server that starts instantly.
      name: 'SOAP mock server',
      url: `${SERVICES.soapServer.baseUrl}/health`
    },
    {
      name: 'OData v2 PetStore Mock',
      url: `${SERVICES.odataV2.baseUrl}/health`
    }
    // No Socket.IO check: restorm self-hosts its Socket.IO server in-instance.
  ]

  const results = await Promise.all(checks.map(waitForService))
  const allReady = results.every(Boolean)

  if (!allReady) {
    throw new Error('Some services failed to start')
  }

  console.log('All services are ready!')
}

/** Get Docker container logs */
export function getContainerLogs(containerName: string): string {
  try {
    return execSync(`docker logs ${containerName} --tail 50`, {
      encoding: 'utf-8'
    })
  } catch {
    return ''
  }
}

/** Check if containers are running by checking if services are accessible */
export async function areServicesAccessible(): Promise<boolean> {
  const checks = [
    { url: `${SERVICES.petstore.baseUrl}/api/pet/findByStatus?status=available` },
    { url: SERVICES.graphql.baseUrl, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"query":"{ __typename }"}' }
  ]

  for (const check of checks) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => { controller.abort(); }, 2000)

      await fetch(check.url, {
        method: check.method ?? 'GET',
        headers: check.headers,
        body: check.body,
        signal: controller.signal
      })

      clearTimeout(timeout)
      return true // Service is accessible
    } catch {
      // Service not accessible
    }
  }
  return false
}

/** Check if containers are running via docker compose */
export function areContainersRunning(): boolean {
  try {
    const output = execSync(`docker compose -f "${DOCKER_COMPOSE_PATH}" ps --format json`, {
      encoding: 'utf-8'
    })
    const lines = output.split('\n').filter(Boolean)
    if (lines.length === 0) return false
    
    const containers = lines.map((line) => {
      try {
        return JSON.parse(line) as { State: string }
      } catch {
        return null
      }
    }).filter(Boolean) as { State: string }[]
    
    return containers.length > 0 && containers.every((c) => c.State === 'running')
  } catch {
    return false
  }
}
