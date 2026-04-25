/**
 * OData v4 `$expand` clause parse / serialize helpers.
 *
 * `$expand` is the richest of the v4 system query options: an expand
 * item can carry its own nested `$select`, `$filter`, `$top`, `$skip`,
 * `$orderby`, and (recursively) `$expand` options inside a
 * parenthesized `;`-delimited list.
 *
 * Grammar (simplified):
 *   expand       = expandItem ( ',' expandItem )*
 *   expandItem   = propertyName ( '(' expandOptions ')' )?
 *   expandOptions = expandOption ( ';' expandOption )*
 *   expandOption = '$select=' <csv>
 *                | '$filter=' <raw>
 *                | '$top='    <raw>
 *                | '$skip='   <raw>
 *                | '$orderby=' <raw>
 *                | '$expand=' expand
 *
 * Parens and commas inside nested $filter/$expand values are
 * respected via paren-depth counting — we don't use a regex.
 */

export interface ExpandNode {
  /** Stable ID so the UI list can use it as a React key. */
  id: string
  /** The navigation property being expanded (e.g. `Tags`). */
  property: string
  /** Per-level nested options. All raw strings — handlebars templates
   * survive the round-trip. */
  select?: string[]
  filter?: string
  top?: string
  skip?: string
  orderby?: string
  /** Recursive nested `$expand` — a list of further ExpandNodes. */
  expand?: ExpandNode[]
}

export function parseExpand(clause: string | undefined): ExpandNode[] {
  if (!clause) return []
  const nodes: ExpandNode[] = []
  for (const item of splitTopLevel(clause, ',')) {
    const trimmed = item.trim()
    if (!trimmed) continue
    nodes.push(parseExpandItem(trimmed))
  }
  return nodes
}

export function serializeExpand(nodes: readonly ExpandNode[]): string {
  return nodes
    .filter((n) => n.property.trim() !== '')
    .map((n) => serializeExpandNode(n))
    .join(',')
}

function parseExpandItem(raw: string): ExpandNode {
  const openParen = raw.indexOf('(')
  if (openParen < 0 || !raw.endsWith(')')) {
    return { id: crypto.randomUUID(), property: raw.trim() }
  }
  const property = raw.slice(0, openParen).trim()
  const body = raw.slice(openParen + 1, raw.length - 1)

  const node: ExpandNode = { id: crypto.randomUUID(), property }
  for (const optRaw of splitTopLevel(body, ';')) {
    const opt = optRaw.trim()
    if (!opt) continue
    const eq = opt.indexOf('=')
    if (eq < 0) continue
    const key = opt.slice(0, eq).trim()
    const value = opt.slice(eq + 1).trim()
    switch (key) {
      case '$select': {
        node.select = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        break
      }
      case '$filter':
        node.filter = value
        break
      case '$top':
        node.top = value
        break
      case '$skip':
        node.skip = value
        break
      case '$orderby':
        node.orderby = value
        break
      case '$expand':
        node.expand = parseExpand(value)
        break
      default:
        break
    }
  }
  return node
}

function serializeExpandNode(node: ExpandNode): string {
  const parts: string[] = []
  if (node.select && node.select.length > 0) {
    parts.push(`$select=${node.select.join(',')}`)
  }
  if (node.filter && node.filter.trim() !== '') parts.push(`$filter=${node.filter}`)
  if (node.top && node.top.trim() !== '') parts.push(`$top=${node.top}`)
  if (node.skip && node.skip.trim() !== '') parts.push(`$skip=${node.skip}`)
  if (node.orderby && node.orderby.trim() !== '') parts.push(`$orderby=${node.orderby}`)
  if (node.expand && node.expand.length > 0) parts.push(`$expand=${serializeExpand(node.expand)}`)

  if (parts.length === 0) return node.property
  return `${node.property}(${parts.join(';')})`
}

/**
 * Split a clause by `separator` at top level — commas/semicolons
 * inside nested parens are preserved. `()` are matched as a single
 * depth counter; non-paren chars are passed through unchanged.
 */
function splitTopLevel(input: string, separator: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === separator && depth === 0) {
      out.push(input.slice(start, i))
      start = i + 1
    }
  }
  out.push(input.slice(start))
  return out
}
