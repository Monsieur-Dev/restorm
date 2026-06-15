#!/usr/bin/env node

/**
 * Wait for Docker services to be ready
 * This script is used in CI pipelines
 */

const http = require('http')
const net = require('net')

const SERVICES = [
  { name: 'Petstore', url: 'http://localhost:8080/api/pet/findByStatus?status=available' },
  { name: 'Petstore OpenAPI 3.0', url: 'http://localhost:8081/openapi.json' },
  { name: 'GraphQL', url: 'http://localhost:4000', method: 'POST', body: '{"query":"{ __typename }"}', headers: { 'Content-Type': 'application/json' } },
  { name: 'SOAP', url: 'http://localhost:8090/castlemock/web' },
  { name: 'Socket.IO', url: 'http://localhost:3001' },
  { name: 'WS Echo', url: 'http://localhost:3002/health' },
  { name: 'OData PetStore', url: 'http://localhost:5100/health' },
  { name: 'Auth Service', url: 'http://localhost:5110/health' },
  // gRPC (moul/grpcbin) speaks HTTP/2 on 9000 — not HTTP/1, so probe the raw TCP
  // port instead of an HTTP endpoint.
  { name: 'gRPC (grpcbin)', tcp: { host: 'localhost', port: 9000 } }
]

const MAX_RETRIES = 60
const RETRY_DELAY = 2000

async function checkService(service) {
  if (service.tcp) {
    return new Promise((resolve) => {
      const socket = net.connect(service.tcp.port, service.tcp.host)
      const done = (ok) => { socket.destroy(); resolve(ok) }
      socket.setTimeout(5000)
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
      socket.once('timeout', () => done(false))
    })
  }
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
