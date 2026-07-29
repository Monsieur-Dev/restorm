import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { configureNextConfirmationDialogForE2E, installSystemModalsMockingForE2E, withE2ELocaleEnv } from 'electron-core-ui/testing'

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

/** Every fixture builds its Electron env through here, making it the ONE
 * place to sanitize the inherited environment. `GIT_*` vars are stripped
 * UNCONDITIONALLY (coverage on or off): when the suite runs under the
 * PRE-PUSH HOOK, git exports GIT_DIR (and friends) pointing at the SOURCE
 * repository — an app inheriting them aims every git command at the dev
 * branch regardless of its simple-git baseDir. This actually committed e2e
 * seed churn into the app's own branch, and made the git suites fail ONLY
 * under the full pre-push run (standalone shells carry no GIT_DIR).
 * Mirrors `gitServerSeed.gitEnv()`'s stripping for the seed commands.
 *
 * It is also where the suite's locale gets pinned (`withE2ELocaleEnv`) —
 * the app defaults its UI language to the OS locale when the user has never
 * picked one, which is the state of every launch here, so without the pin
 * the suite would run in the developer's language and assert against
 * strings CI never renders. */
export function withE2ECoverageEnv(restormRoot: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_') && key !== 'SSH_ASKPASS'))
  const base = withE2ELocaleEnv(sanitized)
  if (!isE2ECoverageEnabled()) return base

  const { v8OutputDir } = getE2ECoverageOutputDirs(restormRoot)
  return {
    ...base,
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
