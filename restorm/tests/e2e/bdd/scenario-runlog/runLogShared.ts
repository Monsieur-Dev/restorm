import { copyFileSync } from 'fs'
import { join, resolve } from 'path'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

/** Reference fixture + its sidecars, committed under `tests/e2e/samples`. */
export const SAMPLES_DIR = resolve(__dirname, '../../samples')
export const REFERENCE_SAMPLE = join(SAMPLES_DIR, 'scenarios-e2e-reference-tests.restorm')
// The committed call-history zip (the runtime `.responses.zip` is gitignored).
export const REFERENCE_RESPONSES = join(SAMPLES_DIR, 'scenarios-e2e-reference-tests.restorm.responses-history.zip')
// Sidecar JSON the `Files` scenario reads by a RELATIVE path → must sit next to
// the working copy (the workspace dir).
export const REFERENCE_SIDECAR = join(SAMPLES_DIR, 'scenarios-e2e-reference-tests.pet-sample.json')

/** One golden per scenario, next to the sample (committed). Regenerate after an
 * intentional change with `UPDATE_RUNLOG_GOLDEN=1`. */
export function goldenPathFor(scenarioName: string): string {
  const slug = scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return join(SAMPLES_DIR, `scenarios-e2e-reference-tests.${slug}-runlog.yaml`)
}

/** Copy the reference project + its call-history zip + the readFile sidecar into
 * `tempDir`, returning the working-copy `.restorm` path. The same layout the
 * interactive run-log e2e AND the headless CLI need. */
export function setupReferenceWorkingCopy(tempDir: string): string {
  const workingCopy = join(tempDir, 'scenarios-e2e-reference-tests.restorm')
  copyFileSync(REFERENCE_SAMPLE, workingCopy)
  copyFileSync(REFERENCE_RESPONSES, `${workingCopy}.responses.zip`)
  copyFileSync(REFERENCE_SIDECAR, join(tempDir, 'scenarios-e2e-reference-tests.pet-sample.json'))
  return workingCopy
}

/** Data keys whose value is an absolute wall-clock instant stamped per run —
 * placeholdered so the golden stays stable (config-embedded dates live under
 * OTHER keys and are left intact so real regressions surface). */
const DYNAMIC_TIME_KEYS = new Set([
  'timestamp', 'now', 'startedAt', 'finishedAt', 'endedAt', 'completedAt', 'durationMs', 'date'
])
/** Header keys whose value is a per-run secret (a freshly-issued Bearer token). */
const MASKED_VALUE_KEYS = new Set(['authorization'])
/** A freshly-generated v4 UUID is non-deterministic → masked. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** The copied message is `<emoji> [<date>] <text>` — replace just the leading
 * date bracket so the run-time doesn't make the golden flaky. */
function normalizeMessage(message: string): string {
  return message.replace(/^(\S+ )\[[^\]]*\]/, '$1[<time>]')
}

function normalizeData(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeData)
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (DYNAMIC_TIME_KEYS.has(k)) out[k] = '<dynamic-time>'
      else if (MASKED_VALUE_KEYS.has(k.toLowerCase())) out[k] = '<masked>'
      else out[k] = normalizeData(val)
    }
    return out
  }
  if (typeof v === 'string' && UUID_V4.test(v)) return '<uuid>'
  return v
}

/** Parse a copied/streamed run-log YAML, strip run-time noise, re-emit canonical
 * YAML. Both the live output and the golden go through this, so they compare
 * deterministically — used by the inspector copy e2e AND the headless CLI e2e. */
export function normalizeRunLogYaml(raw: string): string {
  const entries = yamlParse(raw) as { message: string; data?: unknown }[]
  const normalized = entries.map((e) => {
    const message = normalizeMessage(e.message)
    return 'data' in e ? { message, data: normalizeData(e.data) } : { message }
  })
  return yamlStringify(normalized)
}
