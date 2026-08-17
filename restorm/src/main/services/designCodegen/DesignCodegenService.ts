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

import { logger } from 'electron-core-ui/main'
import type { ApiDesign } from '../../../shared/types/apiDesign'
import { validateApiDesign } from '../../../shared/design/validateApiDesign'
import { buildCodegenContext } from '../../../shared/design/codegenContext'
import { PYODIDE_WORKER_SRC, resolvePyodidePaths } from '../../scenarioEngine/codeRuntimes/pythonRuntime'
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

    const run = await runCodeWorker(PYODIDE_WORKER_SRC, COPIER_SUBSET_ENGINE_PY, {
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
      log: [...run.logs, ...(payload?.log ?? [])]
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
  extract(designId: string, outputRoot: string): { written: string[] } {
    const run = this.pending.get(designId)
    if (run === undefined) {
      throw new Error('no pending generation for this design — generate first')
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
}

export const designCodegenService = new DesignCodegenService()
