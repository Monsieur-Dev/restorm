import { gitServerWorkerFixture, type StartedGitServer } from '../../helpers/testcontainers/gitServer'
import { servicesWorkerFixture, type StartedServices } from '../../helpers/testcontainers/services'
import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'
import { createEmptyRemote, gitEnv } from '../../../integration/gitServerSeed'

const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface CollabSession {
  app: ElectronApplication
  page: Page
  configPath: string
}

/**
 * The two-instance collaborative harness: ONE empty bare remote on the
 * docker git server, one local workspace per actor, and one LIVE restorm
 * instance per actor (isolated userData each, autosave pre-seeded ON with
 * a minimal delay). Sessions are keyed by actor name so steps can address
 * "Yoann"'s window and "Claude"'s window independently while both run
 * side by side.
 */
export interface GitCollabWorld {
  /** Scenario-scoped scratch root holding every actor workspace. */
  root: string
  /** Clone URL of the scenario's shared remote (empty at creation). */
  remoteUrl: string
  /** Live app sessions, keyed by actor name. */
  sessions: Map<string, CollabSession>
  /** Local repo/workspace dir per actor (set by initRepo/cloneRepo). */
  repoDirs: Map<string, string>
  /** Create the scenario's EMPTY shared remote. Idempotent per scenario. */
  createRemote: () => string
  /** `git init` a fresh local repo for `actor`, wired to the remote. */
  initRepo: (actor: string) => string
  /** `git clone` the shared remote into `actor`'s workspace. */
  cloneRepo: (actor: string) => string
  /** Write `yaml` as `fileName` in `actor`'s repo and commit+push it (CLI,
   * harness plumbing) so the app opens an already-clean, published repo. */
  seedCommittedProject: (actor: string, fileName: string, yaml: string) => string
  /** A collaborator pushes a change straight to the remote, WITHOUT going
   * through a restorm instance: clone to a scratch dir, apply a textual
   * substitution to the project file, commit, push. Models "someone else
   * moved the server on while you were working" — the precondition every
   * update-prompt scenario needs, and the one thing a single-instance
   * test cannot produce on its own. */
  collaboratorPushes: (fileName: string, find: string, replace: string) => void
  /** The colleague REMOVES a request and pushes. Deleting a whole YAML
   * block is the one repository-level fixture the substitution helper
   * above cannot express — the block spans lines and its extent depends on
   * indentation. */
  collaboratorDeletesRequest: (fileName: string, requestName: string) => void
  /** The colleague TAGS a request and pushes. The app has no tag editor
   * (tags come from imports), so a divergence can only be authored on this
   * side. */
  collaboratorTagsRequest: (fileName: string, requestName: string, tag: string) => void
  /** The colleague MOVES a request into another folder and pushes — the
   * other half of a contested inter-folder move. */
  collaboratorMovesRequest: (fileName: string, requestName: string, folderName: string) => void
  /** Launch (and register) `actor`'s own restorm instance. */
  launch: (actor: string) => Promise<CollabSession>
  /** The registered page of `actor` — throws if not launched yet. */
  pageOf: (actor: string) => Page
  appOf: (actor: string) => ElectronApplication
  repoDirOf: (actor: string) => string
}

export interface GitCollabFixtures {
  restormRoot: string
  collab: GitCollabWorld
}

function run(command: string, cwd?: string): void {
  execSync(command, { cwd, stdio: 'ignore', env: gitEnv() })
}

/** Deterministic-enough unique remote name per scenario: pid + worker. */
let scenarioCounter = 0

export const test = base.extend<GitCollabFixtures, { gitServer: StartedGitServer; services: StartedServices }>({
  // This suite runs its OWN git daemon (worker-scoped, ephemeral port,
  // mkdtemp repos dir) — the seed-module helpers are routed at it.
  gitServer: gitServerWorkerFixture(),
  // Chapter 1 imports the petstore swagger from a live URL.
  services: servicesWorkerFixture(['petstore']),
  restormRoot: [RESTORM_ROOT, { option: true }],

  collab: async ({ restormRoot, gitServer: _gitServer }, use, testInfo) => {
    const root = mkdtempSync(join(tmpdir(), 'restorm-git-collab-'))
    const sessions = new Map<string, CollabSession>()
    const repoDirs = new Map<string, string>()
    const launchedLogs: { app: ElectronApplication, logs: string[] }[] = []

    scenarioCounter += 1
    const remoteName = `collab-${process.pid}-${testInfo.workerIndex}-${scenarioCounter}`
    let remoteUrl = ''
    let collaboratorPushCount = 0

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const emailFor = (actor: string): string => `${actor.toLowerCase()}@restorm.app`

    const configureLocalRepo = (dir: string, actor: string): void => {
      run(`git config user.name "${actor}"`, dir)
      run(`git config user.email "${emailFor(actor)}"`, dir)
    }

    const world: GitCollabWorld = {
      root,
      get remoteUrl() { return remoteUrl },
      sessions,
      repoDirs,

      createRemote: () => {
        if (!remoteUrl) remoteUrl = createEmptyRemote(remoteName)
        return remoteUrl
      },

      initRepo: (actor: string) => {
        if (!remoteUrl) throw new Error('createRemote() must run before initRepo()')
        const dir = join(root, actor.toLowerCase(), 'projet')
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        run('git init -b main', dir)
        run(`git remote add origin "${remoteUrl}"`, dir)
        configureLocalRepo(dir, actor)
        repoDirs.set(actor, dir)
        return dir
      },

      cloneRepo: (actor: string) => {
        if (!remoteUrl) throw new Error('createRemote() must run before cloneRepo()')
        const dir = join(root, actor.toLowerCase(), 'projet')
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(join(root, actor.toLowerCase()), { recursive: true })
        run(`git clone "${remoteUrl}" "${dir}"`)
        configureLocalRepo(dir, actor)
        repoDirs.set(actor, dir)
        return dir
      },

      seedCommittedProject: (actor: string, fileName: string, yaml: string) => {
        const dir = repoDirs.get(actor)
        if (!dir) throw new Error(`no workspace registered for actor "${actor}"`)
        const filePath = join(dir, fileName)
        writeFileSync(filePath, yaml, 'utf-8')
        run(`git add "${fileName}"`, dir)
        run('git commit -m "Seed project"', dir)
        run('git push -u origin main', dir)
        return filePath
      },

      collaboratorMovesRequest: (fileName: string, requestName: string, folderName: string) => {
        if (!remoteUrl) throw new Error('createRemote() must run before collaboratorMovesRequest()')
        const dir = join(root, `collaborator-${String(collaboratorPushCount++)}`)
        rmSync(dir, { recursive: true, force: true })
        run(`git clone "${remoteUrl}" "${dir}"`)
        run('git config user.name "Collaborator"', dir)
        run('git config user.email "collaborator@restorm.app"', dir)
        const filePath = join(dir, fileName)
        const lines = readFileSync(filePath, 'utf-8').split('\n')
        const lineAt = (index: number): string => lines[index] ?? ''
        const nameIndex = lines.findIndex((line) => line.trim() === `name: ${requestName}`)
        if (nameIndex === -1) throw new Error(`collaboratorMovesRequest: no request named "${requestName}"`)
        let start = nameIndex
        while (start > 0 && !lineAt(start).trimStart().startsWith('- ')) start--
        const indent = lineAt(start).search(/\S/)
        let end = start + 1
        while (end < lines.length && (lineAt(end).trim() === '' || lineAt(end).search(/\S/) > indent)) end++
        const block = lines.splice(start, end - start)
        // The source folder is now empty: leave it as `items: []`, never a
        // bare `items:` (valid YAML that parses to null, not to a list).
        const sourceItemsIndex = start - 1
        if ((lines[sourceItemsIndex] ?? '').trim() === 'items:') {
          lines[sourceItemsIndex] = `${' '.repeat((lines[sourceItemsIndex] ?? '').search(/\S/))}items: []`
        }

        // Drop the block under the destination folder, replacing its empty
        // `items: []` with a real list at the right depth.
        const folderIndex = lines.findIndex((line) => line.trim() === `name: ${folderName}`)
        if (folderIndex === -1) throw new Error(`collaboratorMovesRequest: no folder named "${folderName}"`)
        const itemsIndex = lines.findIndex((line, index) => index > folderIndex && line.trim().startsWith('items:'))
        if (itemsIndex === -1) throw new Error(`collaboratorMovesRequest: "${folderName}" has no items line`)
        const folderIndent = lineAt(itemsIndex).search(/\S/)
        const shift = folderIndent + 2 - indent
        const reindented = block.map((line) => (line.trim() === '' ? line : (shift >= 0 ? ' '.repeat(shift) + line : line.slice(-shift))))
        lines.splice(itemsIndex, 1, `${' '.repeat(folderIndent)}items:`, ...reindented)

        writeFileSync(filePath, lines.join('\n'), 'utf-8')
        run(`git add "${fileName}"`, dir)
        run('git commit -m "Collaborator moved a request"', dir)
        run('git push origin main', dir)
      },

      collaboratorTagsRequest: (fileName: string, requestName: string, tag: string) => {
        if (!remoteUrl) throw new Error('createRemote() must run before collaboratorTagsRequest()')
        const dir = join(root, `collaborator-${String(collaboratorPushCount++)}`)
        rmSync(dir, { recursive: true, force: true })
        run(`git clone "${remoteUrl}" "${dir}"`)
        run('git config user.name "Collaborator"', dir)
        run('git config user.email "collaborator@restorm.app"', dir)
        const filePath = join(dir, fileName)
        const lines = readFileSync(filePath, 'utf-8').split('\n')
        const nameIndex = lines.findIndex((line) => line.trim() === `name: ${requestName}`)
        if (nameIndex === -1) throw new Error(`collaboratorTagsRequest: no request named "${requestName}" in ${fileName}`)
        // The entity's own `tags:` line is the first one at or after its
        // name, within the same block.
        const tagsIndex = lines.findIndex((line, index) => index > nameIndex && line.trim().startsWith('tags:'))
        if (tagsIndex === -1) throw new Error(`collaboratorTagsRequest: "${requestName}" has no tags line`)
        const indent = ' '.repeat(lines[tagsIndex]?.search(/\S/) ?? 8)
        lines[tagsIndex] = `${indent}tags: [${tag}]`
        writeFileSync(filePath, lines.join('\n'), 'utf-8')
        run(`git add "${fileName}"`, dir)
        run('git commit -m "Collaborator tagged a request"', dir)
        run('git push origin main', dir)
      },

      collaboratorDeletesRequest: (fileName: string, requestName: string) => {
        if (!remoteUrl) throw new Error('createRemote() must run before collaboratorDeletesRequest()')
        const dir = join(root, `collaborator-${String(collaboratorPushCount++)}`)
        rmSync(dir, { recursive: true, force: true })
        run(`git clone "${remoteUrl}" "${dir}"`)
        run('git config user.name "Collaborator"', dir)
        run('git config user.email "collaborator@restorm.app"', dir)
        const filePath = join(dir, fileName)
        const lines = readFileSync(filePath, 'utf-8').split('\n')
        const nameIndex = lines.findIndex((line) => line.trim() === `name: ${requestName}`)
        if (nameIndex === -1) throw new Error(`collaboratorDeletesRequest: no request named "${requestName}" in ${fileName}`)
        // Walk back to the list item's own `- ` line, then forward to the
        // next line at that same indentation: that span IS the entity.
        const lineAt = (index: number): string => lines[index] ?? ''
        let start = nameIndex
        while (start > 0 && !lineAt(start).trimStart().startsWith('- ')) start--
        const indent = lineAt(start).search(/\S/)
        let end = start + 1
        while (end < lines.length && (lineAt(end).trim() === '' || lineAt(end).search(/\S/) > indent)) end++
        lines.splice(start, end - start)
        writeFileSync(filePath, lines.join('\n'), 'utf-8')
        run(`git add "${fileName}"`, dir)
        run('git commit -m "Collaborator removed a request"', dir)
        run('git push origin main', dir)
      },

      collaboratorPushes: (fileName: string, find: string, replace: string) => {
        if (!remoteUrl) throw new Error('createRemote() must run before collaboratorPushes()')
        const dir = join(root, `collaborator-${String(collaboratorPushCount++)}`)
        rmSync(dir, { recursive: true, force: true })
        run(`git clone "${remoteUrl}" "${dir}"`)
        run('git config user.name "Collaborator"', dir)
        run('git config user.email "collaborator@restorm.app"', dir)
        const filePath = join(dir, fileName)
        const before = readFileSync(filePath, 'utf-8')
        if (!before.includes(find)) {
          throw new Error(`collaboratorPushes: "${find}" not found in ${fileName}`)
        }
        writeFileSync(filePath, before.replace(find, replace), 'utf-8')
        run(`git add "${fileName}"`, dir)
        run('git commit -m "Collaborator change"', dir)
        run('git push origin main', dir)
      },

      launch: async (actor: string) => {
        const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
        const baseEnv = {
          ...withE2ECoverageEnv(restormRoot, process.env),
          NODE_ENV: 'development',
          RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
          ECUI_DISABLE_GPU: '1',
          // The whole git surface is Pro-gated (`git.client`).
          RESTORM_E2E_ENTITLEMENT_PLAN: 'pro'
        }

        // Bootstrap launch with --clear-settings to discover the userData
        // path, then seed config.json BEFORE the real launch: autosave ON
        // with the minimal debounce, so every edit persists near-instantly
        // and the git flags react without manual saves.
        const bootstrap = await electron.launch({
          executablePath: electronExePath,
          args: ['--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', mainJsPath, '--clear-settings'],
          env: baseEnv
        })
        const userDataPath = await bootstrap.evaluate(({ app }) => app.getPath('userData'))
        const configPath = join(userDataPath, 'config.json')
        bootstrap.process().kill('SIGKILL')
        await new Promise((r) => setTimeout(r, 300))

        writeFileSync(configPath, JSON.stringify({
          'settings:files:autoSave': 'afterDelay',
          'settings:files:autoSaveDelay': 100
        }, null, 2), 'utf-8')

        const app = await electron.launch({
          executablePath: electronExePath,
          args: ['--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', mainJsPath],
          env: baseEnv
        })

        const logs: string[] = []
        app.process().stdout?.on('data', (d: Buffer) => {
          for (const line of d.toString().split('\n')) {
            const trimmed = line.trim()
            if (trimmed) logs.push(`[${actor}:main:out] ${trimmed}`)
          }
        })
        app.process().stderr?.on('data', (d: Buffer) => {
          for (const line of d.toString().split('\n')) {
            const trimmed = line.trim()
            if (trimmed) logs.push(`[${actor}:main:err] ${trimmed}`)
          }
        })
        app.on('window', (p) => {
          p.on('console', (msg) => { logs.push(`[${actor}:renderer:${msg.type()}] ${msg.text()}`) })
          p.on('pageerror', (err) => {
            logs.push(`[${actor}:renderer:pageerror] ${err.message}\n${err.stack ?? ''}`)
          })
          p.on('dialog', (dialog) => { void dialog.accept() })
        })

        const page = await app.firstWindow()
        await page.waitForLoadState('load')
        // Wide enough that the FULL menu bar renders inline (File … Git …
        // Help) — a narrow window collapses the right-side items into the
        // overflow hamburger, where the Git menu testids don't exist.
        // EVERY window, not just the first: the boot splash is still up at
        // this point and owns index 0, so resizing only that one left the
        // real window at its default width — and the menu bar collapsed
        // Git into the overflow, where its testid does not exist.
        const widen = async (): Promise<void> => {
          await app.evaluate(({ BrowserWindow }) => {
            for (const win of BrowserWindow.getAllWindows()) {
              win.setSize(1600, 900)
              win.center()
            }
          })
        }
        await widen()
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await installSystemModalsMockingForE2E(app)
        await page.evaluate(() => {
          window.confirm = () => true
          window.alert = () => undefined
        })
        await page.waitForTimeout(1500)
        // Again once the splash has closed and the main window is revealed:
        // it is only then that the size sticks for the window under test.
        await widen()

        const session: CollabSession = { app, page, configPath }
        sessions.set(actor, session)
        launchedLogs.push({ app, logs })
        return session
      },

      pageOf: (actor: string) => {
        const s = sessions.get(actor)
        if (!s) throw new Error(`no live restorm session for actor "${actor}"`)
        return s.page
      },
      appOf: (actor: string) => {
        const s = sessions.get(actor)
        if (!s) throw new Error(`no live restorm session for actor "${actor}"`)
        return s.app
      },
      repoDirOf: (actor: string) => {
        const dir = repoDirs.get(actor)
        if (!dir) throw new Error(`no workspace registered for actor "${actor}"`)
        return dir
      }
    }

    await use(world)

    mkdirSync(testInfo.outputDir, { recursive: true })
    const blockingErrors: string[] = []
    for (const { app, logs } of launchedLogs) {
      blockingErrors.push(...collectBlockingRendererMessages(logs))
      try {
        if (logs.length > 0) {
          const logFile = join(testInfo.outputDir, 'electron-logs.txt')
          writeFileSync(logFile, logs.join('\n'), { flag: 'a', encoding: 'utf-8' })
        }
      } catch { /* ignore */ }
      try { app.process().kill('SIGKILL') } catch { /* ignore */ }
    }
    try {
      const logFile = join(testInfo.outputDir, 'electron-logs.txt')
      await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
    } catch { /* ignore */ }

    rmSync(root, { recursive: true, force: true })

    if (blockingErrors.length > 0 && testInfo.status === 'passed') {
      const logFile = join(testInfo.outputDir, 'renderer-errors.txt')
      writeFileSync(logFile, blockingErrors.join('\n\n'), 'utf-8')
      await testInfo.attach('renderer-errors', { path: logFile, contentType: 'text/plain' })
      throw new Error(summariseBlockingMessages(blockingErrors))
    }
  }
})

export { expect }
