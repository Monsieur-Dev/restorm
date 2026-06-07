/**
 * Pure YAML parse/stringify core for the scenario `yaml` node — the ONE
 * implementation the RUNTIME (`yamlExecutor`) and the INSPECTOR PREVIEW
 * (`scenarioStaticPreview`) both call, so the two can never drift (same pattern
 * as `scenarioJson` / `scenarioXml`).
 *
 * Built on the `yaml` package (already a restorm dep). `applyYaml` THROWS on
 * malformed YAML (`parse`) or a non-serialisable value (`stringify`). The
 * runtime routes that to the `error` port; the preview catches it into "no
 * result".
 */
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

/** The operations a `yaml` node can run. */
export type YamlOp = 'parse' | 'stringify'

export const YAML_OPS: readonly YamlOp[] = ['parse', 'stringify']

export const isYamlOp = (v: unknown): v is YamlOp =>
  typeof v === 'string' && (YAML_OPS as readonly string[]).includes(v)

/**
 * Run `op` over `value`.
 *
 * - **parse**: a YAML **string** → its value (object / array / scalar).
 *   Malformed YAML THROWS. An already-structured (non-string) value passes
 *   through, so `parse` is idempotent.
 * - **stringify**: any value → a YAML string, indented by `indent` spaces
 *   (clamped to 1–10; YAML always indents — default 2).
 */
export function applyYaml(value: unknown, op: YamlOp, indent = 2): unknown {
  if (op === 'parse') {
    return typeof value === 'string' ? yamlParse(value) : value
  }
  const spaces = typeof indent === 'number' && indent >= 1 ? Math.min(Math.floor(indent), 10) : 2
  return yamlStringify(value, { indent: spaces })
}
