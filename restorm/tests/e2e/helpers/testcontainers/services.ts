/**
 * Worker-scoped service containers for the e2e suites.
 *
 * A suite's fixture file declares the services it needs; each Playwright
 * WORKER gets its own container set on ephemeral host ports, torn down when
 * the worker exits. Isolation is the point: two workers (or two suites) can
 * no longer contend on shared state, which is what forced the old shared
 * compose stack to serialize the stateful suites.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { BUILT_SERVICES, SERVICE_DEFINITIONS } from './registry'

export interface StartedServices {
  /** `http://localhost:<mapped>` for the service. */
  url: (name: string) => string
  /** The EPHEMERAL host port the service is published on. */
  port: (name: string) => number
  /** canonical host port → mapped host port, for sample materialization. */
  portMap: () => Map<number, number>
  /** Run a command inside a service's container (kafka reseed, …). */
  exec: (name: string, command: string[]) => Promise<{ exitCode: number; output: string }>
  /** The raw started container, for anything the wrappers don't cover. */
  container: (name: string) => StartedTestContainer
  stopAll: () => Promise<void>
}

/** Images built from a Dockerfile, once per process (docker layer cache makes reruns cheap). */
const builtImages = new Map<string, Promise<GenericContainer>>()

function buildImageOnce(name: string): Promise<GenericContainer> {
  const existing = builtImages.get(name)
  if (existing) return existing
  const spec = BUILT_SERVICES[name]
  if (!spec) throw new Error(`unknown built service: ${name}`)
  const building = GenericContainer.fromDockerfile(spec.context).build(`restorm-e2e-${name}`, { deleteOnExit: false })
  builtImages.set(name, building)
  return building
}

/**
 * Start every declared service concurrently and return the accessors.
 * Unknown names fail loudly — a typo must not silently become "service
 * missing at connect time" minutes later.
 */
export async function startServices(names: readonly string[]): Promise<StartedServices> {
  const started = new Map<string, { container: StartedTestContainer; containerPort: number; canonicalPort: number }>()
  const extraStops: (() => Promise<void>)[] = []

  await Promise.all(names.map(async (name) => {
    const builtSpec = BUILT_SERVICES[name]
    if (builtSpec) {
      const image = await buildImageOnce(name)
      const container = await image
        .withExposedPorts(builtSpec.containerPort)
        .start()
      started.set(name, { container, containerPort: builtSpec.containerPort, canonicalPort: builtSpec.canonicalPort })
      return
    }
    const def = SERVICE_DEFINITIONS[name]
    if (!def) throw new Error(`unknown e2e service: '${name}' — add it to tests/e2e/helpers/testcontainers/registry.ts`)
    if (def.startCustom) {
      const custom = await def.startCustom()
      extraStops.push(custom.extraStop)
      if (def.seed) await def.seed(custom.container)
      started.set(name, { container: custom.container, containerPort: def.containerPort, canonicalPort: def.canonicalPort })
      return
    }
    if (!def.build) throw new Error(`service '${name}' declares neither build nor startCustom`)
    const container = await (await def.build()).start()
    if (def.seed) await def.seed(container)
    started.set(name, { container, containerPort: def.containerPort, canonicalPort: def.canonicalPort })
  }))

  const get = (name: string): { container: StartedTestContainer; containerPort: number; canonicalPort: number } => {
    const entry = started.get(name)
    if (!entry) throw new Error(`service '${name}' was not declared by this suite`)
    return entry
  }

  return {
    url: (name) => `http://localhost:${String(get(name).container.getMappedPort(get(name).containerPort))}`,
    port: (name) => get(name).container.getMappedPort(get(name).containerPort),
    portMap: () => {
      const map = new Map<number, number>()
      for (const { container, containerPort, canonicalPort } of started.values()) {
        map.set(canonicalPort, container.getMappedPort(containerPort))
      }
      return map
    },
    exec: async (name, command) => {
      const result = await get(name).container.exec(command)
      return { exitCode: result.exitCode, output: result.output }
    },
    container: (name) => get(name).container,
    stopAll: async () => {
      await Promise.all([...started.values()].map(async ({ container }) => container.stop()))
      await Promise.all(extraStops.map(async (stop) => stop()))
    }
  }
}

/**
 * Rewrite every canonical `localhost:<port>` of the started services to its
 * mapped ephemeral port. Committed samples / goldens keep speaking canonical;
 * this is the single boundary where the two vocabularies meet.
 */
export function remapCanonicalPorts(text: string, services: StartedServices): string {
  let out = text
  for (const [canonical, mapped] of services.portMap()) {
    out = out.replaceAll(`localhost:${String(canonical)}`, `localhost:${String(mapped)}`)
    out = out.replaceAll(`127.0.0.1:${String(canonical)}`, `127.0.0.1:${String(mapped)}`)
  }
  return out
}

/**
 * Swagger-imported env folders keep the port as a STANDALONE `port` variable
 * (`{{scheme}}://{{host}}:{{port}}…`), which the joined `localhost:<port>`
 * substring pass cannot see. Walk the parsed document and rewrite any
 * `{ key: 'port', value: { value: <canonical> } }` variable to the mapped
 * port, preserving its string-vs-number type.
 */
function remapPortVariables(node: unknown, portMap: Map<number, number>): void {
  if (Array.isArray(node)) {
    for (const item of node) remapPortVariables(item, portMap)
    return
  }
  if (node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (record['key'] === 'port' && record['value'] !== null && typeof record['value'] === 'object') {
    const value = record['value'] as Record<string, unknown>
    const raw = value['value']
    const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    const mapped = portMap.get(numeric)
    if (mapped !== undefined) value['value'] = typeof raw === 'string' ? String(mapped) : mapped
  }
  for (const child of Object.values(record)) remapPortVariables(child, portMap)
}

/**
 * Copy a committed sample to `targetPath`, remapping canonical service ports
 * to this worker's mapped ones — both joined `localhost:<port>` strings and
 * standalone `port` env variables. ALWAYS copy — beyond the port rewrite, a
 * suite must never open a committed fixture in place (the app stamps a
 * project UUID into a uuid-less file at open, and saves rewrite it).
 */
export function materializeSample(samplePath: string, targetPath: string, services: StartedServices): string {
  mkdirSync(dirname(targetPath), { recursive: true })
  const text = remapCanonicalPorts(readFileSync(samplePath, 'utf-8'), services)
  let out = text
  try {
    // PARSE with the 1.2 core schema — it has NO timestamp type, so a
    // date-like scalar (`'2026-06-05'`) survives as the STRING the app
    // will re-read instead of becoming a Date re-emitted as an ISO
    // timestamp. EMIT with the 1.1 schema — it KNOWS which plain scalars
    // a 1.1 reader (the app uses js-yaml defaults) would type-coerce, and
    // quotes them; the core emitter would drop the protective quotes.
    const doc: unknown = yamlParse(text, { schema: 'core' })
    remapPortVariables(doc, services.portMap())
    out = yamlStringify(doc, { schema: 'yaml-1.1' })
  } catch {
    // Not YAML (or unparseable) — the substring pass already ran; keep it.
  }
  writeFileSync(targetPath, out, 'utf-8')
  return targetPath
}

/**
 * Copy a NON-YAML import fixture (JSON / RAML / …) with canonical service
 * ports remapped. Purely textual — no parse/re-emit, so the format the
 * importer sniffs is byte-preserved apart from the port numbers.
 */
export function materializeTextFixture(sourcePath: string, targetPath: string, services: StartedServices): string {
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, remapCanonicalPorts(readFileSync(sourcePath, 'utf-8'), services), 'utf-8')
  return targetPath
}

/** The worker-fixture tuple every suite fixture file spreads in (playwright-bdd `test.extend`). */
export function servicesWorkerFixture(names: readonly string[]): [
  ({}: object, use: (services: StartedServices) => Promise<void>) => Promise<void>,
  { scope: 'worker'; timeout: number }
] {
  return [
    async ({}: object, use: (services: StartedServices) => Promise<void>): Promise<void> => {
      const services = await startServices(names)
      try {
        await use(services)
      } finally {
        await services.stopAll()
      }
    },
    // Image pulls / dotnet builds on a cold docker cache can be slow; the
    // budget is per-worker-startup, not per-test.
    { scope: 'worker', timeout: 180_000 }
  ]
}

/** `join` re-export spares each fixture a node:path import for temp paths. */
export { join as joinPath }
