import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { configureNextConfirmationDialogForE2E, installSystemModalsMockingForE2E } from 'electron-core-ui/testing'

function sanitizeFileName(value: string): string {
  return value
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '')
}

export function isE2ECoverageEnabled(): boolean {
  return process.env.E2E_COVERAGE === 'true'
}

export function getE2ECoverageOutputDirs(restormRoot: string): { nycOutputDir: string; v8OutputDir: string } {
  return {
    nycOutputDir: join(restormRoot, '.nyc_output'),
    v8OutputDir: join(restormRoot, '.v8-coverage')
  }
}

export function withE2ECoverageEnv(restormRoot: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!isE2ECoverageEnabled()) return env

  const { v8OutputDir } = getE2ECoverageOutputDirs(restormRoot)
  return {
    ...env,
    NODE_V8_COVERAGE: v8OutputDir
  }
}

export async function writeRendererIstanbulCoverage(page: Page, testInfo: TestInfo, restormRoot: string): Promise<void> {
  if (!isE2ECoverageEnabled()) return

  const coverage = await page.evaluate(() => {
    const w = window as unknown as { __coverage__?: unknown }
    return w.__coverage__ ?? null
  }).catch(() => null)

  if (!coverage) return

  const { nycOutputDir } = getE2ECoverageOutputDirs(restormRoot)
  await mkdir(nycOutputDir, { recursive: true })

  const file = typeof testInfo.file === 'string' ? basename(testInfo.file) : 'unknown-file'
  const title = typeof testInfo.title === 'string' ? testInfo.title : 'unknown-title'
  const projectName = typeof testInfo.project.name === 'string' ? testInfo.project.name : 'unknown-project'
  const id = [projectName, file, title, `retry-${String(testInfo.retry)}`].join(' ')

  const fileName = `${sanitizeFileName(id)}.json`
  await writeFile(join(nycOutputDir, fileName), JSON.stringify(coverage), 'utf-8')
}

export async function closeElectronAppForE2E(app: ElectronApplication): Promise<void> {
  // When NODE_V8_COVERAGE is enabled, Node writes coverage data on graceful shutdown.
  // SIGKILL prevents flushing coverage files.
  if (isE2ECoverageEnabled()) {
    try {
      // Ensure any unsaved changes prompt does not block shutdown.
      await installSystemModalsMockingForE2E(app)
      await configureNextConfirmationDialogForE2E(app, {
        buttonKeys: ['file.unsavedChanges.save', 'file.unsavedChanges.dontSave', 'file.unsavedChanges.cancel'],
        choiceKey: 'file.unsavedChanges.dontSave'
      })
      await app.close()
      return
    } catch {
      // fall through to signals
    }
  }

  try {
    app.process().kill(isE2ECoverageEnabled() ? 'SIGTERM' : 'SIGKILL')
  } catch {
    // ignore
  }
}
