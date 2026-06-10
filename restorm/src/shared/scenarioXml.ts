/**
 * Pure XML parse/stringify core for the scenario `xml` node — the ONE
 * implementation the RUNTIME (`xmlExecutor`) and the INSPECTOR PREVIEW
 * (`scenarioStaticPreview`) both call, so the two can never drift (same pattern
 * as `scenarioJson` / `scenarioYaml`).
 *
 * Built on `fast-xml-parser` (pure JS, isomorphic). Attributes are kept under an
 * `@_` prefix so a round-trip (parse → stringify) preserves them.
 *
 * `applyXml` THROWS on invalid input — malformed XML (`parse`, validated first
 * since the parser is otherwise lenient) or a value the builder cannot serialise
 * (`stringify`). The runtime routes that to the `error` port; the preview
 * catches it into "no result".
 */
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser'

/** The operations an `xml` node can run. */
export type XmlOp = 'parse' | 'stringify'

export const XML_OPS: readonly XmlOp[] = ['parse', 'stringify']

export const isXmlOp = (v: unknown): v is XmlOp =>
  typeof v === 'string' && (XML_OPS as readonly string[]).includes(v)

const ATTR_PREFIX = '@_'

/**
 * Run `op` over `value`.
 *
 * - **parse**: an XML **string** → a plain object (attributes under `@_`).
 *   Malformed XML THROWS. An already-structured (non-string) value passes
 *   through, so `parse` is idempotent.
 * - **stringify**: an object → an XML string. `indent > 0` pretty-prints with
 *   that many spaces (capped at 10); `0` is single-line.
 */
export function applyXml(value: unknown, op: XmlOp, indent = 0): unknown {
  if (op === 'parse') {
    if (typeof value !== 'string') return value
    const verdict = XMLValidator.validate(value)
    if (verdict !== true) {
      throw new Error(`Invalid XML: ${verdict.err.msg}`)
    }
    return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: ATTR_PREFIX }).parse(value)
  }
  const spaces = typeof indent === 'number' && indent > 0 ? Math.min(Math.floor(indent), 10) : 0
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    format: spaces > 0,
    indentBy: ' '.repeat(spaces)
  })
  const out: unknown = builder.build(value)
  return typeof out === 'string' ? out.trimEnd() : out
}
