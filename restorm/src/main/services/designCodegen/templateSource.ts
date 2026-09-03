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
import { parse as yamlParse } from 'yaml'
import { withFirewallBypass } from 'electron-core-ui'
import { httpGetBytes } from '../../scenarioEngine/codeRuntimes/depsInstaller'
import { validateAgainstSchema } from '../../../shared/schemaValidate'
import { CODEGEN_CONTEXT_VERSION } from '../../../shared/design/codegenContext'
import type { TemplateVariableDecl } from '../../../shared/design/templateVariables'
export type { TemplateVariableDecl, TemplateVariableScope, TemplateVariableType } from '../../../shared/design/templateVariables'
import { assertSafeRelativePath, type GeneratedFile } from './extractTree'

// The official template registry used to live here as an in-code list. It now
// lives in the cloud (the `templates` Edge Function) and is fetched by the
// code-generation library; a template the user "uses" is stored in the design
// as a plain `repo` source (its git URL). See `cloudTemplates.ts`.

// ── Manifest ──────────────────────────────────────────────────────────

export interface TemplateManifest {
  name: string
  type: 'server' | 'db' | 'docs'
  language: string
  contextVersions: number[]
  /** User variables the template exposes for code generation (optional). */
  variables?: TemplateVariableDecl[]
}

export const MANIFEST_SCHEMA = JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['name', 'type', 'language', 'contextVersions'],
  properties: {
    name: { type: 'string', minLength: 1 },
    type: { enum: ['server', 'db', 'docs'] },
    language: { type: 'string', minLength: 1 },
    contextVersions: { type: 'array', items: { type: 'integer' }, minItems: 1 },
    variables: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'scope', 'type'],
        properties: {
          name: { type: 'string', minLength: 1 },
          scope: { enum: ['project', 'model', 'property', 'route'] },
          type: { enum: ['string', 'boolean', 'number', 'enum'] },
          options: { type: 'array', items: { type: 'string' } },
          default: { type: 'string' },
          description: { type: 'string' }
        },
        additionalProperties: true
      }
    }
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

/** `owner/repo` (or a full github URL) → the raw URL of its ROOT manifest. */
export function rawManifestUrl(repo: string, ref = 'main'): string {
  const cleaned = repo
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) {
    throw new Error(`not a github repository reference: ${repo}`)
  }
  return `https://raw.githubusercontent.com/${cleaned}/${ref}/restorm-template.json`
}

/** Extract just the DECLARED variables from a manifest's JSON text — a lenient
 * parse for the variable editors' pre-fill (no context-version enforcement,
 * which only matters at generation time). */
export function readManifestVariables(text: string): TemplateVariableDecl[] {
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
  return (parsed as TemplateManifest).variables ?? []
}

/** The declared variables of a LOCAL template — reads only its manifest file. */
export function readLocalManifestVariables(path: string): TemplateVariableDecl[] {
  return readManifestVariables(readFileSync(join(path, 'restorm-template.json'), 'utf-8'))
}

/** The declared variables of a REMOTE template — fetches ONLY the manifest file
 * (not the whole tarball), over the firewall bypass. */
export async function fetchRemoteManifestVariables(repo: string, ref = 'main'): Promise<TemplateVariableDecl[]> {
  const bytes = await withFirewallBypass(() => httpGetBytes(rawManifestUrl(repo, ref)))
  return readManifestVariables(Buffer.from(bytes).toString('utf-8'))
}

// ── Copier questions (template answers) ───────────────────────────────

/** A `copier.yml` question surfaced to the user for a whole-generation answer
 * — Copier's own template parametrization (distinct from `.vars.` codegen
 * variables, which are per-entity Handlebars). `_`-prefixed Copier meta keys
 * (`_subdirectory`, `_templates_suffix`…) are NOT questions and never appear. */
export interface TemplateQuestion {
  key: string
  /** Copier answer type; drives the value editor. Unknown types fall back to `str`. */
  type: 'str' | 'int' | 'float' | 'bool' | 'yaml' | 'json'
  /** The template's default answer (used to pre-fill and to prune redundant saves). */
  default?: unknown
  help?: string
  /** Allowed values (a Copier `choices` list, or the values of a choices map). */
  choices?: (string | number)[]
  /** Copier `multiselect: true` — pick several of `choices`. */
  multiselect?: boolean
  multiline?: boolean
  placeholder?: string
  secret?: boolean
}

const COPIER_TYPES = new Set(['str', 'int', 'float', 'bool', 'yaml', 'json'])
function normalizeQuestionType(raw: unknown): TemplateQuestion['type'] {
  return typeof raw === 'string' && COPIER_TYPES.has(raw) ? raw as TemplateQuestion['type'] : 'str'
}
function inferQuestionType(literal: unknown): TemplateQuestion['type'] {
  if (typeof literal === 'boolean') return 'bool'
  if (typeof literal === 'number') return Number.isInteger(literal) ? 'int' : 'float'
  return 'str'
}
/** Copier `choices` is a list (`[a, b]`) or a map (`{Label: value}`); either way
 * we surface the selectable VALUES as scalars. */
function normalizeChoices(raw: unknown): (string | number)[] | undefined {
  const scalar = (v: unknown): string | number | undefined =>
    typeof v === 'string' || typeof v === 'number' ? v : undefined
  if (Array.isArray(raw)) {
    const out = raw.map(scalar).filter((v): v is string | number => v !== undefined)
    return out.length > 0 ? out : undefined
  }
  if (raw !== null && typeof raw === 'object') {
    const out = Object.values(raw as Record<string, unknown>).map(scalar).filter((v): v is string | number => v !== undefined)
    return out.length > 0 ? out : undefined
  }
  return undefined
}

/** Extract the user-facing questions from a `copier.yml`'s YAML text — lenient
 * (no schema enforcement): a mapping of key → spec, skipping `_`-prefixed meta
 * keys. A bare `key: value` shorthand becomes a typed question defaulting to
 * that value. */
export function readCopierQuestions(text: string): TemplateQuestion[] {
  let parsed: unknown
  try {
    parsed = yamlParse(text)
  } catch {
    throw new Error('copier.yml is not valid YAML')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const out: TemplateQuestion[] = []
  for (const [key, spec] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.startsWith('_')) continue // Copier meta keys are not questions
    if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
      const s = spec as Record<string, unknown>
      const q: TemplateQuestion = { key, type: normalizeQuestionType(s['type']) }
      if ('default' in s) q.default = s['default']
      if (typeof s['help'] === 'string') q.help = s['help']
      const choices = normalizeChoices(s['choices'])
      if (choices !== undefined) q.choices = choices
      if (s['multiselect'] === true) q.multiselect = true
      if (s['multiline'] === true) q.multiline = true
      if (typeof s['placeholder'] === 'string') q.placeholder = s['placeholder']
      if (s['secret'] === true) q.secret = true
      out.push(q)
    } else {
      out.push({ key, type: inferQuestionType(spec), default: spec })
    }
  }
  return out
}

/** `owner/repo` (or a full github URL) → the raw URL of a root file. */
function rawRepoFileUrl(repo: string, ref: string, file: string): string {
  const cleaned = repo
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) {
    throw new Error(`not a github repository reference: ${repo}`)
  }
  return `https://raw.githubusercontent.com/${cleaned}/${ref}/${file}`
}

/** The Copier questions of a LOCAL template — reads only its copier.yml/.yaml
 * (absent → no questions). */
export function readLocalCopierQuestions(path: string): TemplateQuestion[] {
  for (const file of ['copier.yml', 'copier.yaml']) {
    try {
      return readCopierQuestions(readFileSync(join(path, file), 'utf-8'))
    } catch { /* try the next filename, else none */ }
  }
  return []
}

/** Read the answers saved by a previous generation from an output folder's
 * `.copier-answers.yml` (Copier round-trip). Meta keys (`_`-prefixed) are
 * stripped. Absent / unreadable / non-mapping → `{}` (fall back to defaults). */
export function readAnswersFile(outputRoot: string): Record<string, unknown> {
  let text: string
  try {
    text = readFileSync(join(outputRoot, '.copier-answers.yml'), 'utf-8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = yamlParse(text)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key.startsWith('_')) out[key] = value
  }
  return out
}

/** The Copier questions of a REMOTE template — fetches ONLY the copier.yml
 * (not the whole tarball), over the firewall bypass; absent → no questions. */
export async function fetchRemoteCopierQuestions(repo: string, ref = 'main'): Promise<TemplateQuestion[]> {
  for (const file of ['copier.yml', 'copier.yaml']) {
    try {
      const bytes = await withFirewallBypass(() => httpGetBytes(rawRepoFileUrl(repo, ref, file)))
      return readCopierQuestions(Buffer.from(bytes).toString('utf-8'))
    } catch { /* try the next filename, else none */ }
  }
  return []
}

/**
 * DISCOVERY (the introspection "filet"): the user-variable names a template's
 * text ACTUALLY references — every `.vars.<name>` (dot) and `.vars['<name>']`
 * (bracket) access across its Jinja files, whatever object it hangs off
 * (`ctx.design`, a `{% for m in ctx.models %}` loop var, `route`…). A heuristic
 * regex, not a full Jinja AST, but it catches the standard access patterns; the
 * UI reconciles the result with the DECLARED variables to flag undeclared ones.
 */
const VAR_ACCESS_RE = /\.vars\.([A-Za-z_]\w*)|\.vars\[\s*['"]([^'"\]]+)['"]\s*\]/g
export function scanUsedVariables(text: string): string[] {
  const names = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = VAR_ACCESS_RE.exec(text)) !== null) {
    const name = match[1] ?? match[2]
    if (name !== undefined && name !== '') names.add(name)
  }
  return [...names].sort()
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
