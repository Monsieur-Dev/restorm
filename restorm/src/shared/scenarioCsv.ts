/**
 * Pure CSV core for the scenario `csv` node — the ONE implementation the RUNTIME
 * (`csvExecutor`) and the INSPECTOR PREVIEW (`scenarioStaticPreview`) both call,
 * so the two can never drift (same pattern as `scenarioJson` / `scenarioXml` /
 * `scenarioYaml`, the rest of the data-format family).
 *
 * `parse`: a CSV string → a list (of row-objects when `header`, else of cell
 * arrays). `stringify`: a list → a CSV string. The reader is a small RFC 4180
 * tokenizer (quoted fields, "" escapes, embedded delimiters / newlines).
 * `applyCsv` THROWS on the wrong operand shape; the runtime routes that to the
 * `error` port and the preview catches it into "no result".
 */

/** The operations a `csv` node can run. */
export type CsvOp = 'parse' | 'stringify'

export const CSV_OPS: readonly CsvOp[] = ['parse', 'stringify']

export const isCsvOp = (v: unknown): v is CsvOp =>
  typeof v === 'string' && (CSV_OPS as readonly string[]).includes(v)

export interface CsvOptions {
  /** Field separator (default ','). */
  delimiter?: string | undefined
  /** First row is a header → row-objects (default true). */
  header?: boolean | undefined
}

/** RFC 4180 tokenizer: text → rows of raw cell strings. */
function parseRows(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text.charAt(i)
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i += 1; continue
      }
      field += c; i += 1; continue
    }
    if (c === '"') { inQuotes = true; i += 1; continue }
    if (c === delim) { row.push(field); field = ''; i += 1; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i += 1
      row.push(field); field = ''
      rows.push(row); row = []
      i += 1; continue
    }
    field += c; i += 1
  }
  // Flush the trailing field/row unless the text ended on a clean newline.
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** Serialize one cell, quoting only when it carries a delimiter / quote / newline. */
function encodeCell(v: unknown, delim: string): string {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v as number | boolean)
  return /["\r\n]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Run `op` over `value`.
 *
 * - **parse**: a CSV string → `[{col: cell, …}, …]` when `header` (default),
 *   else `[[cell, …], …]`.
 * - **stringify**: a list of row-objects → a header + rows; a list of arrays →
 *   rows as-is.
 */
export function applyCsv(value: unknown, op: CsvOp, opts: CsvOptions = {}): unknown {
  const delim = typeof opts.delimiter === 'string' && opts.delimiter.length > 0 ? opts.delimiter : ','
  const header = opts.header !== false
  if (op === 'parse') {
    if (typeof value !== 'string') throw new Error('csv "parse" expects a string')
    const rows = parseRows(value, delim)
    if (!header) return rows
    const [head, ...body] = rows
    if (head === undefined) return []
    return body.map((cells) => {
      const obj: Record<string, string> = {}
      head.forEach((key, i) => { obj[key] = cells[i] ?? '' })
      return obj
    })
  }
  // stringify
  if (!Array.isArray(value)) throw new Error('csv "stringify" expects a list')
  const rows: unknown[] = value
  if (rows.length === 0) return ''
  const first: unknown = rows[0]
  if (Array.isArray(first) || !header) {
    return rows.map((row) => (Array.isArray(row) ? row : [row]).map((c) => encodeCell(c, delim)).join(delim)).join('\n')
  }
  // List of objects → union of keys (first-seen order) as the header.
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row !== null && typeof row === 'object') {
      for (const k of Object.keys(row as Record<string, unknown>)) if (!seen.has(k)) { seen.add(k); keys.push(k) }
    }
  }
  const lines = [keys.map((k) => encodeCell(k, delim)).join(delim)]
  for (const row of rows) {
    const obj = row !== null && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    lines.push(keys.map((k) => encodeCell(obj[k], delim)).join(delim))
  }
  return lines.join('\n')
}
