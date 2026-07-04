/**
 * tRPC router introspection importer — best-effort.
 *
 * tRPC has no standardised schema-introspection endpoint (unlike GraphQL's
 * `__schema` query): a server MAY expose one at a well-known path
 * (`<base>/.trpc/_schema`, the shape this restorm mock + docker fixture
 * implement), but the shape varies by router adapter (Express, Fastify,
 * Next.js, …) and many servers expose none at all. Per the ticket's scope,
 * this importer only understands the schema-root shape documented below —
 * procedures + their input/output type hints — and bails out gracefully
 * (returns `null`, `canImport` refuses) on anything else. There is no
 * fallback "guess the shape" heuristic: an unrecognised JSON document is
 * simply not a tRPC schema as far as this importer is concerned.
 *
 * To import: paste (or fetch) the schema URL itself, e.g.
 * `http://localhost:8096/.trpc/_schema`, into restorm's Import dialog —
 * same URL-import flow every other format uses. `opts.sourceUrl` carries
 * that URL; the base server URL is derived by stripping the well-known
 * suffix so each generated request's `url` field points at the real server.
 */

import {
  EnvironmentFolder,
  TrpcRequest
} from '../../../shared/models'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'
import { stableImportId as generateId } from './stableImportId'

const SCHEMA_PATH_SUFFIX = '/.trpc/_schema'

interface TrpcProcedureSchema {
  kind?: string
  input?: Record<string, string>
  output?: Record<string, string>
}

interface TrpcSchemaDocument {
  procedures?: Record<string, TrpcProcedureSchema>
}

/** Best-effort example JSON for a procedure's declared input shape — one
 * primitive placeholder value per field, `{}` for no/unrecognised input.
 * Good enough to seed a request the user edits before running it; this
 * importer makes no attempt at full type fidelity. */
function synthesizeExampleInput(input: Record<string, string> | undefined): string {
  if (!input || Object.keys(input).length === 0) return ''
  const example: Record<string, unknown> = {}
  for (const [field, type] of Object.entries(input)) {
    switch (type) {
      case 'number':
        example[field] = 0
        break
      case 'boolean':
        example[field] = false
        break
      default:
        example[field] = ''
    }
  }
  return JSON.stringify(example)
}

/** Derive the base server URL from the fetched schema URL by stripping the
 * well-known `/.trpc/_schema` suffix. Falls back to a Handlebars placeholder
 * when the schema was pasted directly (no `sourceUrl` — e.g. from a file). */
function baseUrlFrom(sourceUrl: string | undefined): string {
  if (!sourceUrl) return '{{baseUrl}}'
  return sourceUrl.endsWith(SCHEMA_PATH_SUFFIX)
    ? sourceUrl.slice(0, -SCHEMA_PATH_SUFFIX.length)
    : sourceUrl
}

/**
 * Parse a tRPC schema-introspection document into an `EnvironmentFolder` of
 * `TrpcRequest`s — one per declared procedure, seeded with a best-effort
 * example input.
 */
export function importTrpcSchema(content: string, options: { sourceUrl?: string; name?: string } = {}): EnvironmentFolder {
  const doc = JSON.parse(content) as TrpcSchemaDocument
  const baseUrl = baseUrlFrom(options.sourceUrl)
  const name = options.name ?? 'tRPC API'

  const items: TrpcRequest[] = []
  for (const [procedure, spec] of Object.entries(doc.procedures ?? {})) {
    // Skip anything that doesn't declare a recognised call kind rather than
    // guessing — an unrecognised procedure shape is silently dropped, not
    // defaulted, so a partially-understood schema doesn't produce a request
    // that would execute the wrong verb.
    if (spec.kind !== 'query' && spec.kind !== 'mutation') continue

    items.push(new TrpcRequest({
      id: generateId(`${name}:trpc:${procedure}`),
      name: procedure,
      tags: [spec.kind],
      url: baseUrl,
      procedure,
      input: synthesizeExampleInput(spec.input),
      kind: spec.kind
    }))
  }

  return new EnvironmentFolder({
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    importSource: 'trpc',
    id: generateId(`${name}:folder:trpc:root`),
    name,
    tags: [],
    environments: [],
    items
  })
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

/** Sniff the restorm tRPC schema shape: a `procedures` object with AT LEAST
 * ONE entry carrying a recognised `kind`. Only one is required (not every
 * entry) so a server on a router adapter this importer partly understands
 * still detects as tRPC — `importTrpcSchema` skips the unrecognised entries
 * individually rather than rejecting the whole document. Still deliberately
 * narrow overall — a false-positive match against an unrelated JSON document
 * (e.g. a Postman/Bruno export that happens to have a `procedures` key) is
 * worse than refusing and falling through to "unsupported format". */
function canImport(content: string, _filePath?: string, parsed?: unknown): boolean {
  let json: unknown
  if (parsed !== undefined) {
    json = parsed
  } else {
    try {
      json = JSON.parse(content)
    } catch {
      return false
    }
  }
  if (!json || typeof json !== 'object' || !('procedures' in json)) return false
  const procedures = (json as TrpcSchemaDocument).procedures
  if (!procedures || typeof procedures !== 'object' || Array.isArray(procedures)) return false
  const entries = Object.values(procedures)
  return entries.some((p) => p.kind === 'query' || p.kind === 'mutation')
}

importProviders.push({
  format: 'trpc',
  canImport,
  parse: (content, opts) => importTrpcSchema(content, { ...(opts.sourceUrl !== undefined ? { sourceUrl: opts.sourceUrl } : {}) })
})
