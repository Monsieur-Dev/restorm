#!/usr/bin/env node

/**
 * Wait for Docker services to be ready
 * This script is used in CI pipelines
 */

const http = require('http')

const SERVICES = [
  { name: 'Petstore', url: 'http://localhost:8080/api/pet/findByStatus?status=available' },
  { name: 'GraphQL', url: 'http://localhost:4000', method: 'POST', body: '{"query":"{ __typename }"}', headers: { 'Content-Type': 'application/json' } },
  { name: 'SOAP', url: 'http://localhost:8090/castlemock/web' },
  { name: 'Socket.IO', url: 'http://localhost:3001' },
  { name: 'OData PetStore', url: 'http://localhost:5100/health' }
]

const MAX_RETRIES = 60
const RETRY_DELAY = 2000

async function checkService(service) {
  return new Promise((resolve) => {
    const url = new URL(service.url)
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: service.method || 'GET',
      headers: service.headers || {},
      timeout: 5000
    }

    const req = http.request(options, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })

    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })

    if (service.body) {
      req.write(service.body)
    }
    req.end()
  })
}

async function waitForService(service) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const ready = await checkService(service)
    if (ready) {
      console.log(`✓ ${service.name} is ready`)
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
  }
  console.log(`✗ ${service.name} failed to start`)
  return false
}

async function main() {
  console.log('Waiting for Docker services...')
  
  const results = await Promise.all(SERVICES.map(waitForService))
  const allReady = results.every(Boolean)
  
  if (allReady) {
    console.log('All services are ready!')
    process.exit(0)
  } else {
    console.error('Some services failed to start')
    process.exit(1)
  }
}

main()
