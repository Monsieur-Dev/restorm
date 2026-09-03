/**
 * Design Codegen Service — orchestrates a sandboxed generation run:
 * acquire the template (official / user repo / local folder), refuse an
 * invalid design or an incompatible manifest BEFORE anything renders,
 * project the design into the versioned context, run the Copier-subset
 * engine inside Pyodide's MEMFS (worker_thread, interruptible,
 * memory-bounded — the scenario-code harness), and hand back the
 * generated tree for the VALIDATION SCREEN. Nothing touches the disk
 * until {@link extract} is called with the user-confirmed output root.
 */

import { createHash } from 'node:crypto'
import { logger } from 'electron-core-ui/main'
import type { ApiDesign, DesignTemplateSource } from '../../../shared/types/apiDesign'
import { validateApiDesign } from '../../../shared/design/validateApiDesign'
import { buildCodegenContext, type CodegenVarsBinding } from '../../../shared/design/codegenContext'
import type { CodegenVarError } from '../../../shared/design/templateVariables'
import { resolveTemplate } from '../request/resolveTemplate'
import { resolvePyodidePaths } from '../../scenarioEngine/codeRuntimes/pythonRuntime'
import { CODEGEN_WORKER_SRC } from './codegenWorker'
import { runCodeWorker } from '../../scenarioEngine/codeRuntimes/codeWorkerHarness'
import { COPIER_SUBSET_ENGINE_PY } from './copierSubsetEngine'
import { ensureCodegenWheels } from './pyodideDistWheels'
import {
  acquireLocalTemplate,
  acquireRemoteTemplate,
  fetchRemoteManifestVariables,
  readLocalManifestVariables,
  fetchRemoteCopierQuestions,
  readLocalCopierQuestions,
  readAnswersFile,
  scanUsedVariables,
  type AcquiredTemplate,
  type TemplateManifest,
  type TemplateQuestion,
  type TemplateVariableDecl
} from './templateSource'
import { extractGeneratedTreeMerging, type GeneratedFile } from './extractTree'

/** Where a template comes from — the Code section's three sources. Alias
 * of the persisted {@link DesignTemplateSource} so the run's source and
 * the design's stored source are one type (no drift between them). */
export type TemplateSourceRef = DesignTemplateSource

export interface CodegenPreviewFile {
  path: string
  bytes: number
}

export interface CodegenRunResult {
  manifest: TemplateManifest
  /** The generated tree, held in memory until extraction. */
  files: GeneratedFile[]
  preview: CodegenPreviewFile[]
  log: string[]
  /** The template source that produced this tree — the SECOND staleness
   * anchor (BB3 covers the design; this covers the template). */
  source: TemplateSourceRef
  /** Fingerprint of the design at GENERATION time — extraction refuses
   * when the design has changed since (the preview showed old files). */
  designFingerprint: string
  /** Per-variable resolution failures (bad Handlebars expression or a value
   * that didn't fit the declared type) — surfaced to the user, never silent.
   * Absent / empty when every declared variable resolved. */
  variableErrors?: CodegenVarError[]
}

/** A stable cache key for a template source. */
function sourceCacheKey(source: TemplateSourceRef): string {
  if (source.kind === 'repo') return `repo:${source.repo}@${source.ref ?? 'main'}`
  return `local:${source.path}`
}

/** Two template source refs point at the same template. */
function sameSource(a: TemplateSourceRef, b: TemplateSourceRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'repo' && b.kind === 'repo') return a.repo === b.repo && (a.ref ?? 'main') === (b.ref ?? 'main')
  if (a.kind === 'local' && b.kind === 'local') return a.path === b.path
  return false
}

/**
 * Stable fingerprint of the design's GENERATION-RELEVANT content. The
 * `codegen` slot (template source + output folder) is deliberately
 * excluded: persisting it between preview and confirm — which the UI
 * does on every folder pick — must not invalidate the preview, and it
 * has no effect on the generated tree. Keys are canonically sorted so
 * two serialization routes (renderer JSON vs `toPlainObject`) hash the
 * same design identically.
 */
export function designFingerprint(design: ApiDesign): string {
  const { codegen: _codegen, ...rest } = design as ApiDesign & { codegen?: unknown }
  return createHash('sha256').update(canonicalJson(rest)).digest('hex')
}

/** Deterministic JSON: object keys sorted at every depth, arrays kept
 * in order. Undefined values are dropped (JSON semantics). */
function canonicalJson(value: unknown): string {
  // A top-level `undefined` never reaches here (callers pass an object
  // and undefined entries are filtered below); JSON.stringify is total
  // for the remaining primitives.
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** A cold Pyodide boot + wheel mount + a real template needs room; the
 * SIGINT mailbox + terminate still bound a runaway hook. */
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000

class DesignCodegenService {
  /** Last generation per design — what {@link extract} writes. */
  private pending = new Map<string, CodegenRunResult>()

  async acquire(source: TemplateSourceRef): Promise<AcquiredTemplate> {
    if (source.kind === 'local') return acquireLocalTemplate(source.path)
    return acquireRemoteTemplate(source.repo, source.ref ?? 'main')
  }

  /**
   * Run a generation into memory. Refusals (invalid design, missing or
   * incompatible manifest, engine error) throw with a user-readable
   * message; nothing is written anywhere.
   */
  async generate(
    design: ApiDesign,
    source: TemplateSourceRef,
    answers: Record<string, unknown> = {}
  ): Promise<CodegenRunResult> {
    const issues = validateApiDesign(design)
    if (issues.length > 0) {
      throw new Error(`design has ${issues.length} validation issue(s) — fix them before generating code`)
    }
    const template = await this.acquire(source)
    // User-declared template variables: values live on the matching configured
    // template row (globals) + on each model/route (per-entity overrides). Build
    // the binding only when the template declares variables; the Handlebars
    // evaluation is the same resolver requests use.
    const decls = template.manifest.variables ?? []
    const templateRow = design.codegen?.templates?.find((t) => sameSource(t.source, source))
    const variableErrors: CodegenVarError[] = []
    const binding: CodegenVarsBinding | undefined = decls.length > 0
      ? {
          decls,
          ...(templateRow?.variables !== undefined ? { values: templateRow.variables } : {}),
          modelOverrides: (modelId) => templateRow === undefined
            ? undefined
            : design.models.find((m) => m.id === modelId)?.design?.codegenVars?.[templateRow.id],
          propertyOverrides: (propertyId) => {
            if (templateRow === undefined) return undefined
            for (const m of design.models) {
              const p = m.properties.find((prop) => prop.id === propertyId)
              if (p !== undefined) return p.design?.codegenVars?.[templateRow.id]
            }
            return undefined
          },
          routeOverrides: (routeId) => {
            if (templateRow === undefined) return undefined
            for (const g of design.routeGroups) {
              const r = g.routes.find((rt) => rt.id === routeId)
              if (r !== undefined) return r.design?.codegenVars?.[templateRow.id]
            }
            return undefined
          },
          evaluate: (expression, ctx) => resolveTemplate(expression, ctx),
          errors: variableErrors
        }
      : undefined
    const context = buildCodegenContext(design, binding)
    if (variableErrors.length > 0) {
      logger.warn('[DesignCodegenService] template variables failed to resolve', {
        designId: design.id, count: variableErrors.length
      })
    }
    const wheelPaths = await ensureCodegenWheels()

    const run = await runCodeWorker(CODEGEN_WORKER_SRC, COPIER_SUBSET_ENGINE_PY, {
      input: { files: template.files, context, answers },
      variables: {},
      timeoutMs: GENERATION_TIMEOUT_MS,
      workerData: { ...resolvePyodidePaths(), wheelPaths }
    })

    const payload = run.result as { files?: GeneratedFile[]; log?: string[] } | null
    const files = payload?.files ?? []
    if (files.length === 0) {
      throw new Error('the template generated no files')
    }
    const result: CodegenRunResult = {
      manifest: template.manifest,
      files,
      preview: files.map((f) => ({ path: f.path, bytes: Buffer.from(f.b64, 'base64').length })),
      log: [...run.logs, ...(payload?.log ?? [])],
      designFingerprint: designFingerprint(design),
      source,
      ...(variableErrors.length > 0 ? { variableErrors } : {})
    }
    this.pending.set(design.id, result)
    logger.info('[DesignCodegenService] generated', {
      designId: design.id,
      template: template.manifest.name,
      files: files.length
    })
    return result
  }

  /** Per-source cache of a template's declared variables — acquiring a remote
   * template is expensive, and the UI asks for these each time a codegen tab
   * opens. Cleared with the pending runs on {@link clear}. */
  private readonly variablesCache = new Map<string, TemplateVariableDecl[]>()

  /**
   * The variables a template DECLARES in its manifest (for the design's
   * variable editors to pre-fill). Acquires the template (cached per source) and
   * returns `manifest.variables ?? []`. Never throws for a missing declaration —
   * only for an unreachable / invalid template.
   */
  async getTemplateVariables(source: TemplateSourceRef): Promise<TemplateVariableDecl[]> {
    const key = sourceCacheKey(source)
    const cached = this.variablesCache.get(key)
    if (cached !== undefined) return cached
    // Fetch ONLY the manifest (not the whole template) — a local read or a raw
    // single-file GitHub fetch, so opening a codegen tab never downloads a tarball.
    let variables: TemplateVariableDecl[]
    if (source.kind === 'local') {
      variables = readLocalManifestVariables(source.path)
    } else {
      variables = await fetchRemoteManifestVariables(source.repo, source.ref ?? 'main')
    }
    this.variablesCache.set(key, variables)
    return variables
  }

  private readonly questionsCache = new Map<string, TemplateQuestion[]>()

  /**
   * The Copier QUESTIONS a template declares in its `copier.yml` — the
   * template's own whole-generation parametrization (e.g. `project_slug`),
   * distinct from the per-entity `.vars.` codegen variables. Fetches ONLY the
   * copier.yml (cached per source); a template without one returns `[]`.
   */
  async getTemplateQuestions(source: TemplateSourceRef): Promise<TemplateQuestion[]> {
    const key = sourceCacheKey(source)
    const cached = this.questionsCache.get(key)
    if (cached !== undefined) return cached
    let questions: TemplateQuestion[]
    if (source.kind === 'local') {
      questions = readLocalCopierQuestions(source.path)
    } else {
      questions = await fetchRemoteCopierQuestions(source.repo, source.ref ?? 'main')
    }
    this.questionsCache.set(key, questions)
    return questions
  }

  /**
   * The answers a previous generation saved in an output folder's
   * `.copier-answers.yml` (Copier round-trip). NOT cached — it is re-read every
   * time the output folder is (re)selected, so switching targets reloads that
   * folder's answers. Absent → `{}` (the UI then falls back to copier defaults).
   */
  readAnswers(outputRoot: string): Record<string, unknown> {
    return readAnswersFile(outputRoot)
  }

  private readonly usedVarsCache = new Map<string, string[]>()

  /**
   * DISCOVERY: the user-variable names a template's files actually reference
   * (`.vars.<name>`). Unlike {@link getTemplateVariables} this needs the whole
   * template, so it acquires it (cached). The UI reconciles this with the
   * DECLARED set to flag undeclared-but-used variables.
   */
  async getTemplateUsedVariables(source: TemplateSourceRef): Promise<string[]> {
    const key = sourceCacheKey(source)
    const cached = this.usedVarsCache.get(key)
    if (cached !== undefined) return cached
    const template = await this.acquire(source)
    const names = new Set<string>()
    for (const file of template.files) {
      for (const name of scanUsedVariables(Buffer.from(file.b64, 'base64').toString('utf-8'))) names.add(name)
    }
    const used = [...names].sort()
    this.usedVarsCache.set(key, used)
    return used
  }

  /** The pending (not yet extracted) run for a design, if any. */
  pendingRun(designId: string): CodegenRunResult | undefined {
    return this.pending.get(designId)
  }

  /**
   * Write the pending generation under the CONFIRMED output root.
   * Traversal-checked as a whole before the first byte lands.
   */
  extract(designId: string, outputRoot: string, currentDesign: ApiDesign): { written: string[]; conflicts: string[] } {
    const run = this.pending.get(designId)
    if (run === undefined) {
      throw new Error('no pending generation for this design — generate first')
    }
    // Staleness anchor #1 (BB3): the previewed tree belongs to the
    // design as it WAS — an edit between preview and confirm silently
    // writing old files is the trap the validation screen exists to
    // avoid. `currentDesign` is REQUIRED so no call site can drop the
    // check by omission (DD1).
    if (designFingerprint(currentDesign) !== run.designFingerprint) {
      throw new Error('the design changed since the preview — generate again')
    }
    // Staleness anchor #2 (DD2, updated for the template LIST — TASK-468.20):
    // the previewed tree belongs to ONE template. If that source is no longer
    // among the design's configured templates (the row was removed or its
    // source re-pointed between preview and confirm), refuse to write its
    // stale tree. Skipped when the design carries no list (a transient MCP
    // generate that never persisted a template).
    const templates = currentDesign.codegen?.templates ?? []
    if (templates.length > 0 && !templates.some((tpl) => sameSource(tpl.source, run.source))) {
      throw new Error('the template that produced this preview is no longer configured — generate again')
    }
    const { written, conflicts } = extractGeneratedTreeMerging(run.files, outputRoot)
    this.pending.delete(designId)
    logger.info('[DesignCodegenService] extracted', { designId, outputRoot, files: written.length, conflicts: conflicts.length })
    return { written, conflicts }
  }

  /** Drop a pending run (the user dismissed the validation screen). */
  discard(designId: string): void {
    this.pending.delete(designId)
  }

  /** Drop EVERY pending run — project close / app teardown (the trees
   * carry whole file contents; they must not outlive their project). */
  clear(): void {
    this.pending.clear()
    this.variablesCache.clear()
    this.questionsCache.clear()
    this.usedVarsCache.clear()
  }
}

export const designCodegenService = new DesignCodegenService()
