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
  { name: 'tRPC mock server', url: 'http://localhost:8096/health' },
  { name: 'HTTP util', url: 'http://localhost:8082/health' },
  // The E2E suite uses the soap-server mock (:8091), not Castle Mock (:8090).
  // soap-server is a zero-dependency node:http server started by the CI
  // manual-start step (no seeding required).
  { name: 'SOAP mock server', url: 'http://localhost:8091/health' },
  { name: 'SOAP (Castle Mock)', url: 'http://localhost:8090/castlemock/web' },
  { name: 'SSE mock server', url: 'http://localhost:8097/health' },
  // No Socket.IO / WS mock: restorm self-hosts those servers in-instance.
  { name: 'OData PetStore', url: 'http://localhost:5100/health' },
  { name: 'OData v2 PetStore', url: 'http://localhost:5102/health' },
  { name: 'JSON-RPC mock', url: 'http://localhost:8095/health' },
  { name: 'Auth Service', url: 'http://localhost:5110/health' },
  // gRPC (moul/grpcbin) speaks HTTP/2 on 9000 — not HTTP/1, so probe the raw TCP
  // port instead of an HTTP endpoint.
  { name: 'gRPC (grpcbin)', tcp: { host: 'localhost', port: 9000 } },
  // gRPC-Web (same grpcbin container, its HTTP/1.1 endpoint mapped to 9002).
  { name: 'gRPC-Web (grpcbin)', tcp: { host: 'localhost', port: 9002 } },
  { name: 'Connect-RPC mock', url: 'http://localhost:8093/health' },
  // MQTT (eclipse-mosquitto) speaks the MQTT protocol on 1883 — not HTTP, so
  // probe the raw TCP port.
  { name: 'MQTT (mosquitto)', tcp: { host: 'localhost', port: 1883 } },
  // RabbitMQ takes longer than mosquitto to become ready (broker + the
  // management HTTP API both have to come up) — probe the management
  // plugin's aliveness-test endpoint (does a real publish+consume against
  // the default vhost `/`, not just a port-open check) rather than the raw
  // AMQP port on :5672. Default guest/guest credentials only work for
  // loopback connections, which is exactly what CI does here.
  {
    name: 'RabbitMQ (management)',
    url: 'http://localhost:15672/api/aliveness-test/%2F',
    headers: { Authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}` }
  },
  // Redis speaks the RESP protocol on 6379 — not HTTP, so probe the raw TCP
  // port (mirrors the MQTT / gRPC probes above).
  { name: 'Redis', tcp: { host: 'localhost', port: 6379 } }
  // STOMP (rmohr/activemq) speaks STOMP-over-WebSocket on 61614 — not plain
  // HTTP, so probe the raw TCP port (a WS handshake needs the `Upgrade`
  // header dance, which a plain HTTP GET would fail even once the broker is
  // actually ready).
  { name: 'STOMP (activemq)', tcp: { host: 'localhost', port: 61614 } }
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
