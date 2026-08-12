import { createWriteStream, type WriteStream } from 'fs'
import { scenarioEngine } from '../scenarioEngine/engine'
import type { RunLogEntry } from '../scenarioEngine/types'
import { resolveScenarioTarget } from './resolveScenario'
import { collectionStore } from '../services/CollectionStore'
import { findOrphanScenarioEdges, describeOrphanScenarioEdge } from '../../shared/scenarioValidation'
import type { Scenario } from '../../shared/types/collections'
import { serializeRunLogEntries, filterUserLogs } from '../../shared/scenarioRunLog/serializeRunLog'
import type { CliRunOptions } from './args'

/**
 * Execute a scenario headlessly (no renderer), streaming its run-log to the
 * console and, optionally, a file (append/tail). Returns the process exit code:
 *   0 — scenario completed
 *   1 — scenario failed / cancelled / engine error
 *   2 — could not resolve the scenario or open the output file
 *
 * The project must already be loaded into `collectionStore` (see
 * `loadProjectIntoStore`). Each entry is serialized through the SAME shared
 * serializer the inspector's "copy logs" uses, so a CLI run's output is
 * byte-identical to a copy-paste from the UI (verbose ⇒ the all-logs view).
 */
export async function runScenarioHeadless(cliRun: CliRunOptions): Promise<number> {
  const resolved = resolveScenarioTarget(cliRun.target, cliRun.by)
  if ('error' in resolved) {
    process.stderr.write(`${resolved.error}\n`)
    return 2
  }

  // Refuse a scenario carrying an edge wired to a port its node no longer has:
  // the scheduler would register the stale port as a required input nothing can
  // satisfy, so the node silently never fires and the run still reports
  // `completed`. The editor's load-time sanitizer never runs headless, so this
  // is the only gate that catches it here.
  const scenario = collectionStore.findById(resolved.id) as unknown as Scenario | null
  if (scenario) {
    const orphans = findOrphanScenarioEdges(scenario)
    if (orphans.length > 0) {
      process.stderr.write(`cannot run scenario '${resolved.id}': ${orphans.length} orphan edge(s) wired to a port that no longer exists:\n`)
      for (const orphan of orphans) process.stderr.write(`  ${describeOrphanScenarioEdge(orphan)}\n`)
      return 2
    }
  }

  let out: WriteStream | null = null
  if (cliRun.outFile !== undefined) {
    try {
      out = createWriteStream(cliRun.outFile, { flags: 'a' })
    } catch (err) {
      process.stderr.write(`cannot open --out file '${cliRun.outFile}': ${err instanceof Error ? err.message : String(err)}\n`)
      return 2
    }
  }

  // Per-entry sink: filter (user-only vs all), serialize as a one-item YAML
  // sequence so concatenated entries equal the batch "copy logs" output, and
  // write to stdout + the optional file the moment the entry is emitted.
  const onLog = (entry: RunLogEntry): void => {
    const kept = filterUserLogs([entry], cliRun.verbose)
    if (kept.length === 0) return
    const text = serializeRunLogEntries(kept)
    process.stdout.write(text)
    out?.write(text)
  }

  let exitCode = 0
  try {
    const handle = scenarioEngine.start(resolved.id, { interactive: false, params: cliRun.params }, onLog)
    await handle.done
    exitCode = handle.scheduler.status().state === 'completed' ? 0 : 1
  } catch (err) {
    process.stderr.write(`scenario run failed: ${err instanceof Error ? err.message : String(err)}\n`)
    exitCode = 1
  } finally {
    if (out !== null) await new Promise<void>((resolve) => { out.end(resolve) })
  }
  return exitCode
}
