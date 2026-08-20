/**
 * Template acquisition — the three sources of the Code section:
 *   (a) the OFFICIAL registry embedded below (public Restorm repos),
 *   (b) a user-added repository (typically a fork of an official one),
 *   (c) a LOCAL folder (template development mode, zero network).
 * Remote repositories arrive as a codeload TARBALL over the firewall-
 * bypassed provisioning path (SSRF-guarded, size-capped) — never a git
 * clone — and every archive entry is traversal-checked before it
 * touches the cache (the `npmBundle` extract-without-filter shape is
 * deliberately NOT reproduced here).
 *
 * Every acquired template is validated by its `restorm-template.json`
 * manifest: JSON-Schema shape first, then the CONTEXT VERSION contract
 * — a template that doesn't declare support for our context version is
 * refused with a message naming both sides.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { x as tarExtract } from 'tar'
import { Readable } from 'node:stream'
import { withFirewallBypass } from 'electron-core-ui'
import { httpGetBytes } from '../../scenarioEngine/codeRuntimes/depsInstaller'
import { validateAgainstSchema } from '../../../shared/schemaValidate'
import { CODEGEN_CONTEXT_VERSION } from '../../../shared/design/codegenContext'
import { assertSafeRelativePath, type GeneratedFile } from './extractTree'

// ── Official registry ─────────────────────────────────────────────────

export interface OfficialTemplate {
  id: string
  /** `owner/repo` on github. */
  repo: string
  type: 'server' | 'db'
  /** Display language/stack label. */
  stack: string
  /** One-line description shown under the repo name in the library modal
   * (TASK-468.20) and returned by the MCP template-contract tool. */
  description: string
}

/** The embedded registry (AC#8's half (a)) — one entry per official
 * public template repository. */
export const OFFICIAL_TEMPLATES: readonly OfficialTemplate[] = [
  {
    id: 'server-rest-typescript',
    repo: 'Monsieur-Dev/restorm-template-server-rest-typescript',
    type: 'server',
    stack: 'REST · TypeScript · Express',
    description: 'REST server in TypeScript on Express — typed routes, models and request validation.'
  },
  {
    id: 'server-rest-dotnet',
    repo: 'Monsieur-Dev/restorm-template-server-rest-dotnet',
    type: 'server',
    stack: 'REST · C# · ASP.NET Core',
    description: 'Minimal-API REST server in C# / ASP.NET Core — endpoints, DTOs and validation.'
  },
  {
    id: 'server-grpc-typescript',
    repo: 'Monsieur-Dev/restorm-template-server-grpc-typescript',
    type: 'server',
    stack: 'gRPC · TypeScript',
    description: 'gRPC server in TypeScript — .proto service, typed messages and server stubs.'
  },
  {
    id: 'server-grpc-dotnet',
    repo: 'Monsieur-Dev/restorm-template-server-grpc-dotnet',
    type: 'server',
    stack: 'gRPC · C# / .NET',
    description: 'gRPC server in C# / .NET — .proto service, messages and server stubs.'
  },
  {
    id: 'db-postgres',
    repo: 'Monsieur-Dev/restorm-template-db-postgres',
    type: 'db',
    stack: 'SQL · PostgreSQL',
    description: 'PostgreSQL schema, seed data and CRUD scripts derived from the design.'
  }
]

// ── Manifest ──────────────────────────────────────────────────────────

export interface TemplateManifest {
  name: string
  type: 'server' | 'db'
  language: string
  contextVersions: number[]
}

export const MANIFEST_SCHEMA = JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['name', 'type', 'language', 'contextVersions'],
  properties: {
    name: { type: 'string', minLength: 1 },
    type: { enum: ['server', 'db'] },
    language: { type: 'string', minLength: 1 },
    contextVersions: { type: 'array', items: { type: 'integer' }, minItems: 1 }
  },
  additionalProperties: true
})

/** Parse + validate a manifest, then enforce the context contract. */
export function parseTemplateManifest(text: string): TemplateManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('restorm-template.json is not valid JSON')
  }
  const result = validateAgainstSchema(parsed, MANIFEST_SCHEMA)
  if (!result.valid) {
    throw new Error(`restorm-template.json is invalid: ${result.errors.join('; ')}`)
  }
  const manifest = parsed as TemplateManifest
  if (!manifest.contextVersions.includes(CODEGEN_CONTEXT_VERSION)) {
    throw new Error(
      `template "${manifest.name}" supports context version(s) ${manifest.contextVersions.join(', ')} ` +
      `but this Restorm produces version ${CODEGEN_CONTEXT_VERSION} — update the template (or Restorm)`
    )
  }
  return manifest
}

// ── Acquisition ───────────────────────────────────────────────────────

export interface AcquiredTemplate {
  manifest: TemplateManifest
  /** Every template file, path RELATIVE to the template root. */
  files: GeneratedFile[]
}

/** Files larger than this never enter the sandbox (a template is text
 * plus small assets — a 50 MB blob is a mistake or an attack). */
const MAX_TEMPLATE_FILE_BYTES = 5 * 1024 * 1024

function collectDir(root: string): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) { walk(absolute); continue }
      if (!entry.isFile()) continue
      const size = statSync(absolute).size
      const rel = relative(root, absolute).split('\\').join('/')
      if (size > MAX_TEMPLATE_FILE_BYTES) {
        throw new Error(`template file too large (${Math.round(size / 1024)} KiB): ${rel}`)
      }
      files.push({ path: rel, b64: readFileSync(absolute).toString('base64') })
    }
  }
  walk(root)
  return files
}

function requireManifest(files: GeneratedFile[]): TemplateManifest {
  const manifest = files.find((f) => f.path === 'restorm-template.json')
  if (manifest === undefined) {
    throw new Error('not a Restorm template: restorm-template.json is missing at the root')
  }
  return parseTemplateManifest(Buffer.from(manifest.b64, 'base64').toString('utf8'))
}

/** Source (c): a local folder. */
export function acquireLocalTemplate(root: string): AcquiredTemplate {
  const files = collectDir(root)
  return { manifest: requireManifest(files), files }
}

/** `owner/repo` (or a full github URL) → the codeload tarball URL. */
export function templateArchiveUrl(repo: string, ref = 'main'): string {
  const cleaned = repo
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) {
    throw new Error(`not a github repository reference: ${repo}`)
  }
  return `https://codeload.github.com/${cleaned}/tar.gz/refs/heads/${ref}`
}

/** Sources (a)+(b): fetch a repository tarball and read the template
 * out of it. Every entry path is traversal-checked during extraction. */
export async function acquireRemoteTemplate(repo: string, ref = 'main'): Promise<AcquiredTemplate> {
  const url = templateArchiveUrl(repo, ref)
  const bytes = await withFirewallBypass(() => httpGetBytes(url))
  const scratch = mkdtempSync(join(tmpdir(), 'restorm-template-'))
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const stream = Readable.from(Buffer.from(bytes)).pipe(tarExtract({
        cwd: scratch,
        // Github tarballs wrap everything in `<repo>-<ref>/`.
        strip: 1,
        // Zip-slip guard: refuse links + any entry that normalizes
        // outside the scratch root.
        filter: (path, entry) => {
          if (entry.type !== 'File' && entry.type !== 'Directory') return false
          try {
            assertSafeRelativePath(path)
            return true
          } catch {
            return false
          }
        }
      }))
      stream.on('finish', () => { resolvePromise() })
      stream.on('error', (err: Error) => { rejectPromise(err) })
    })
    const files = collectDir(scratch)
    return { manifest: requireManifest(files), files }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
