/**
 * Per-service container definitions for the e2e suites — a 1:1 mirror of
 * `tests/docker/docker-compose.yml`, expressed as Testcontainers builders.
 *
 * Each suite starts ONLY the services it declares (see `services.ts`), on
 * EPHEMERAL host ports, and tears them down with the worker. The canonical
 * port is the fixed host port the compose file used to publish; committed
 * samples and feature files still speak in canonical ports, and the harness
 * rewrites canonical → mapped at the boundary (sample materialization, step
 * helpers, run-log normalization). The compose file itself stays in the repo
 * for manual/dev use — nothing in the e2e harness reads it.
 */

import { join } from 'node:path'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { KafkaContainer } from '@testcontainers/kafka'

/** Directory the compose file lives in — mocks' sources are bind-mounted from here. */
export const DOCKER_DIR = join(__dirname, '../../../docker')

export interface ServiceDefinition {
  /** The port the service listens on INSIDE the container. */
  containerPort: number
  /**
   * The fixed host port the shared compose file published — the number
   * committed samples / feature files reference. Never bound by the harness;
   * only used as the substitution KEY when rewriting to the mapped port.
   */
  canonicalPort: number
  /** Build the (unstarted) container. Async so a definition can pre-compute
   * (e.g. reserve a host port a self-advertising image must know at boot). */
  build?: () => GenericContainer | Promise<GenericContainer>
  /** Fully custom startup for composite services (sidecar + network). The
   * returned container is the one the suite talks to; `extraStop` tears the
   * rest down. */
  startCustom?: () => Promise<{ container: StartedTestContainer; extraStop: () => Promise<void> }>
  /** Optional post-start hook (topic seeding, …). */
  seed?: (container: StartedTestContainer) => Promise<void>
}

/**
 * A zero-dependency `node:http` mock whose source dir is bind-mounted —
 * the exact shape the compose file uses for jsonrpc / trpc / soap-server /
 * sse-server / http-util / odata-v2 / grpcweb / connect.
 */
function nodeMock(sourceDir: string, port: number, opts?: { health?: string }): ServiceDefinition {
  return {
    containerPort: port,
    canonicalPort: port,
    build: () =>
      new GenericContainer('node:20-alpine')
        .withWorkingDir('/app')
        .withBindMounts([{ source: join(DOCKER_DIR, sourceDir), target: '/app', mode: 'ro' }])
        .withCommand(['node', 'server.js'])
        .withExposedPorts(port)
        .withWaitStrategy(
          opts?.health !== undefined
            ? Wait.forHttp(opts.health, port).withStartupTimeout(30_000)
            : Wait.forListeningPorts()
        )
  }
}

/**
 * The registry. Keys are the names suites declare in `requiredServices`.
 *
 * Kept in ONE map (rather than per-suite files) so the canonical-port
 * substitution table is derivable from the declaration alone, and so a
 * service definition is written once however many suites consume it.
 */
export const SERVICE_DEFINITIONS: Record<string, ServiceDefinition> = {
  // ── Zero-dependency node mocks (instant boot) ────────────────────────────
  'http-util': nodeMock('http-util', 8082),
  'odata-v2-petstore': nodeMock('odata-v2-petstore', 5102),
  jsonrpc: nodeMock('jsonrpc-server', 8095),
  trpc: nodeMock('trpc-server', 8096),
  'soap-server': nodeMock('soap-server', 8091, { health: '/health' }),
  'sse-server': nodeMock('sse-server', 8097, { health: '/health' }),
  'grpcweb-mock': nodeMock('grpcweb-server', 9002, { health: '/health' }),
  'connect-mock': nodeMock('connect-server', 8093, { health: '/health' }),

  // ── Public images ────────────────────────────────────────────────────────
  petstore: {
    containerPort: 8080,
    canonicalPort: 8080,
    // NOTE: the swagger the image serves advertises a STATIC
    // `host: localhost:8080` (ignores the Host header and SWAGGER_HOST —
    // measured). That is fine for every current consumer: suites either
    // execute requests from MATERIALIZED samples (ports remapped at copy
    // time) or import the spec without ever executing it. A future suite
    // that imports from URL AND executes must front it with a rewriting
    // proxy.
    build: () =>
      new GenericContainer('swaggerapi/petstore')
        .withExposedPorts(8080)
        .withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(60_000))
  },
  'petstore-openapi3': {
    containerPort: 8080,
    canonicalPort: 8081,
    build: () =>
      new GenericContainer('openapitools/openapi-petstore')
        .withExposedPorts(8080)
        .withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(60_000))
  },
  graphql: {
    containerPort: 4000,
    canonicalPort: 4000,
    build: () =>
      new GenericContainer('node:20-alpine')
        .withWorkingDir('/app')
        .withBindMounts([{ source: join(DOCKER_DIR, 'graphql-server'), target: '/app' }])
        .withCommand(['sh', '-c', 'npm install && node server.js'])
        .withExposedPorts(4000)
        // npm install runs at boot — wait for the actual listener, generously.
        .withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(120_000))
  },
  grpc: {
    containerPort: 9000,
    canonicalPort: 9000,
    build: () =>
      new GenericContainer('moul/grpcbin')
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(60_000))
  },
  redis: {
    containerPort: 6379,
    canonicalPort: 6379,
    build: () =>
      new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/).withStartupTimeout(30_000))
  },
  mqtt: {
    containerPort: 1883,
    canonicalPort: 1883,
    build: () =>
      new GenericContainer('eclipse-mosquitto:2')
        .withBindMounts([
          { source: join(DOCKER_DIR, 'mosquitto.conf'), target: '/mosquitto/config/mosquitto.conf' },
          { source: join(DOCKER_DIR, 'mosquitto-passwd'), target: '/mosquitto/config/passwd', mode: 'ro' }
        ])
        .withExposedPorts(1883)
        .withWaitStrategy(Wait.forLogMessage(/mosquitto version .* running/).withStartupTimeout(30_000))
  },
  activemq: {
    containerPort: 61614,
    canonicalPort: 61614,
    build: () =>
      new GenericContainer('rmohr/activemq:5.15.9')
        .withExposedPorts(61614)
        // Java 8 sizes its fd table to the HARD nofile limit; the unbounded
        // default some daemons hand out makes the JVM abort at boot with
        // "unable to allocate file descriptor table". Bound it.
        .withUlimits({ nofile: { soft: 65536, hard: 65536 } })
        // The compose healthcheck was a plain TCP probe on the STOMP-over-WS
        // port; mirror that rather than guessing at a log line.
        .withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(60_000))
  },
  rabbitmq: {
    containerPort: 5672,
    canonicalPort: 5672,
    build: () =>
      new GenericContainer('rabbitmq:3-management')
        .withBindMounts([
          { source: join(DOCKER_DIR, 'rabbitmq.conf'), target: '/etc/rabbitmq/conf.d/10-restorm-e2e.conf', mode: 'ro' },
          { source: join(DOCKER_DIR, 'rabbitmq-definitions.json'), target: '/etc/rabbitmq/definitions.json', mode: 'ro' }
        ])
        .withExposedPorts(5672)
        .withWaitStrategy(Wait.forLogMessage(/Server startup complete/).withStartupTimeout(90_000))
  },

  kafka: {
    containerPort: 9093,
    canonicalPort: 9092,
    // `KafkaContainer` owns the two-phase start that rewires the ADVERTISED
    // listener to the mapped host port — the one thing a plain
    // GenericContainer over the compose recipe cannot do (the advertised
    // address must be known before the broker starts, the mapped port only
    // after). Its client port is 9093.
    build: () => new KafkaContainer('confluentinc/cp-kafka:7.6.1').withKraft() as unknown as GenericContainer,
    seed: async (container) => {
      const broker = 'localhost:9092'
      const bin = '/usr/bin'
      const create = await container.exec([`${bin}/kafka-topics`, '--bootstrap-server', broker, '--create', '--if-not-exists', '--topic', 'restorm-test', '--partitions', '1', '--replication-factor', '1'])
      if (create.exitCode !== 0) throw new Error(`kafka topic create failed: ${create.output}`)
      const produce = await container.exec(['sh', '-c', `printf 'seed-message-1\nseed-message-2\nseed-message-3\n' | ${bin}/kafka-console-producer --bootstrap-server ${broker} --topic restorm-test`])
      if (produce.exitCode !== 0) throw new Error(`kafka seed produce failed: ${produce.output}`)
    }
  },

  // ── Built images (multi-stage Dockerfiles, cached by docker layer cache) ─
  'auth-service': {
    containerPort: 5110,
    canonicalPort: 5110,
    build: () => {
      throw new Error('auth-service is built asynchronously — resolved via buildImageOnce in services.ts')
    }
  },
  'odata-petstore': {
    containerPort: 5100,
    canonicalPort: 5100,
    build: () => {
      throw new Error('odata-petstore is built asynchronously — resolved via buildImageOnce in services.ts')
    }
  }
}

/** Dockerfile-built services: context dir + the exposed port, consumed by services.ts. */
export const BUILT_SERVICES: Record<string, { context: string; containerPort: number; canonicalPort: number; health: string }> = {
  'auth-service': { context: join(DOCKER_DIR, 'auth-service'), containerPort: 5110, canonicalPort: 5110, health: '/health' },
  'odata-petstore': { context: join(DOCKER_DIR, 'odata-petstore'), containerPort: 5100, canonicalPort: 5100, health: '/health' }
}
