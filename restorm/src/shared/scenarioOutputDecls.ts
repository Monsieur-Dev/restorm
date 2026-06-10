/**
 * An `output` node declares one or more named scenario outputs (the symmetric
 * counterpart of an `input` node's params). Each output has a name and its OWN
 * `value` input port (id = the decl id), so several values can be exposed from
 * one box. A parent `runScenario` derives one `output:<name>` port per decl.
 *
 * Persisted as `config.outputs: OutputDecl[]`. {@link readOutputDecls} also
 * migrates the legacy single-output shape (`config.name`, with its `value`
 * input port) on read, so old scenarios keep working without a disk rewrite.
 */
export interface OutputDecl {
  id: string
  name: string
  /** Literal fallback emitted when the decl's `value` input port is NOT wired —
   * mirrors the `object` builder's per-property value. A persisted typed value
   * (`{ type, value }`); absent on legacy / wired-only decls. */
  value?: unknown
}

/** Stable id for the default (not-yet-persisted) first output row shown on an
 * empty output node, mirroring the input/object default rows. */
export const OUTPUT_DEFAULT_DECL_ID = 'output-default-decl'

/** Port id of the legacy single-output node's `value` input — reused as the
 * migrated decl's id so an existing wired edge keeps resolving. */
export const LEGACY_OUTPUT_PORT_ID = 'value'

function isOutputDecl(d: unknown): d is OutputDecl {
  return typeof d === 'object' && d !== null
    && typeof (d as { id?: unknown }).id === 'string'
    && typeof (d as { name?: unknown }).name === 'string'
}

/** The output node's decls, migrating the legacy single-output config on read. */
export function readOutputDecls(config: Record<string, unknown>): OutputDecl[] {
  const raw = config['outputs']
  if (Array.isArray(raw)) return raw.filter(isOutputDecl)
  // Legacy single output: { name } wired through the `value` input port.
  if (typeof config['name'] === 'string') {
    return [{ id: LEGACY_OUTPUT_PORT_ID, name: config['name'] }]
  }
  return []
}
