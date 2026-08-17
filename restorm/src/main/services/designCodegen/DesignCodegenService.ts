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
import type { ApiDesign } from '../../../shared/types/apiDesign'
import { validateApiDesign } from '../../../shared/design/validateApiDesign'
import { buildCodegenContext } from '../../../shared/design/codegenContext'
import { resolvePyodidePaths } from '../../scenarioEngine/codeRuntimes/pythonRuntime'
import { CODEGEN_WORKER_SRC } from './codegenWorker'
import { runCodeWorker } from '../../scenarioEngine/codeRuntimes/codeWorkerHarness'
import { COPIER_SUBSET_ENGINE_PY } from './copierSubsetEngine'
import { ensureCodegenWheels } from './pyodideDistWheels'
import {
  acquireLocalTemplate,
  acquireRemoteTemplate,
  OFFICIAL_TEMPLATES,
  type AcquiredTemplate,
  type TemplateManifest
} from './templateSource'
import { extractGeneratedTree, type GeneratedFile } from './extractTree'

/** Where a template comes from — the Code section's three sources. */
export type TemplateSourceRef =
  | { kind: 'official'; id: string }
  | { kind: 'repo'; repo: string; ref?: string }
  | { kind: 'local'; path: string }

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
  /** Fingerprint of the design at GENERATION time — extraction refuses
   * when the design has changed since (the preview showed old files). */
  designFingerprint: string
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
    if (source.kind === 'repo') return acquireRemoteTemplate(source.repo, source.ref ?? 'main')
    const official = OFFICIAL_TEMPLATES.find((t) => t.id === source.id)
    if (official === undefined) {
      throw new Error(`unknown official template: ${source.id}`)
    }
    return acquireRemoteTemplate(official.repo)
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
    const context = buildCodegenContext(design)
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
      designFingerprint: designFingerprint(design)
    }
    this.pending.set(design.id, result)
    logger.info('[DesignCodegenService] generated', {
      designId: design.id,
      template: template.manifest.name,
      files: files.length
    })
    return result
  }

  /** The pending (not yet extracted) run for a design, if any. */
  pendingRun(designId: string): CodegenRunResult | undefined {
    return this.pending.get(designId)
  }

  /**
   * Write the pending generation under the CONFIRMED output root.
   * Traversal-checked as a whole before the first byte lands.
   */
  extract(designId: string, outputRoot: string, currentDesign?: ApiDesign): { written: string[] } {
    const run = this.pending.get(designId)
    if (run === undefined) {
      throw new Error('no pending generation for this design — generate first')
    }
    // Staleness anchor: the previewed tree belongs to the design as it
    // WAS — an edit between preview and confirm silently writing old
    // files is exactly the trap the validation screen exists to avoid.
    if (currentDesign !== undefined && designFingerprint(currentDesign) !== run.designFingerprint) {
      throw new Error('the design changed since the preview — generate again')
    }
    const written = extractGeneratedTree(run.files, outputRoot)
    this.pending.delete(designId)
    logger.info('[DesignCodegenService] extracted', { designId, outputRoot, files: written.length })
    return { written }
  }

  /** Drop a pending run (the user dismissed the validation screen). */
  discard(designId: string): void {
    this.pending.delete(designId)
  }

  /** Drop EVERY pending run — project close / app teardown (the trees
   * carry whole file contents; they must not outlive their project). */
  clear(): void {
    this.pending.clear()
  }
}

export const designCodegenService = new DesignCodegenService()
