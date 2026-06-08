import { createWriteStream, type WriteStream } from 'fs'
import { scenarioEngine } from '../scenarioEngine/engine'
import type { RunLogEntry } from '../scenarioEngine/types'
import { resolveScenarioTarget } from './resolveScenario'
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
