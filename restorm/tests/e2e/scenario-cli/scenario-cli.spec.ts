import { test, expect } from '@playwright/test'
import { spawn } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import electronPath from 'electron'
import { goldenPathFor, normalizeRunLogYaml, setupReferenceWorkingCopy } from '../bdd/scenario-runlog/runLogShared'
import { startServices, type StartedServices } from '../helpers/testcontainers/services'

/**
 * Headless CLI runner: spawn the BUILT app with `--run` and assert the
 * streamed run-log is byte-identical (after the same normalization the inspector
 * e2e uses) to the committed golden, plus the exit-code contract. No window, no
 * page — just stdout + exit code, the way a CI/cron invocation sees it.
 */

const MAIN_JS = join(process.cwd(), 'dist/main/index.js')
const ELECTRON = electronPath as unknown as string

interface CliResult { code: number | null; stdout: string; stderr: string }

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    // Each invocation gets its OWN userData dir. Without it every CLI run
    // shares the default profile and takes its single-instance lock: a second
    // run forwards its argv to the first and quits, so the caller sees an
    // empty stdout and a hang until the test's timeout. That made this suite
    // pass or fail depending on what else happened to be running.
    const isolatedUserDataDir = mkdtempSync(join(tmpdir(), 'restorm-cli-'))
    const child = spawn(ELECTRON, ['--no-sandbox', '--ozone-platform=x11', MAIN_JS, ...args], {
      // RESTORM_E2E_ENTITLEMENT_PLAN seeds Pro entitlement so the headless gate
      // is bypassed in dev builds — mirrors mcp-server.fixture.ts.
      env: {
        ...process.env,
        TZ: 'UTC',
        NODE_ENV: 'development',
        RESTORM_E2E_ENTITLEMENT_PLAN: 'pro',
        RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir
      }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => { resolve({ code, stdout, stderr }) })
  })
}

function freshProject(prefix: string): string {
  return setupReferenceWorkingCopy(mkdtempSync(join(tmpdir(), prefix)), services)
}

/** The scenarios the CLI runs call these mocks (Main fans out across them). */
let services: StartedServices

test.beforeAll(async () => {
  // Image pulls / kafka + dotnet startup dominate; cached reruns are fast.
  test.setTimeout(300_000)
  // Same set as the scenario-runlog suite: Main orchestrates across every
  // protocol sub-scenario, and some dependencies (SSE) are invisible in the
  // normalized goldens.
  services = await startServices(['petstore', 'auth-service', 'rabbitmq', 'activemq', 'redis', 'jsonrpc', 'trpc', 'sse-server', 'grpc', 'grpcweb-mock', 'kafka'])
})
test.afterAll(async () => {
  await services.stopAll()
})

const LOGS = 'Auth Service/Pet API/Main/Logs'
const MAIN = 'Auth Service/Pet API/Main'

test.describe('headless CLI scenario runner', () => {
  test('streams a leaf scenario run-log identical to the golden, exit 0', async () => {
    const project = freshProject('restorm-cli-logs-')
    const res = await runCli(['--open', project, '--run', LOGS, '--all-logs', '--headless'])
    expect(res.code, res.stderr).toBe(0)
    expect(normalizeRunLogYaml(res.stdout)).toBe(normalizeRunLogYaml(readFileSync(goldenPathFor('Logs'), 'utf-8')))
  })

  test('runs the orchestrator Main with --param, matching the golden, exit 0', async () => {
    const project = freshProject('restorm-cli-main-')
    const res = await runCli([
      '--open', project, '--run', MAIN, '--all-logs', '--headless',
      '--param', 'SecondInput=2030-01-15T08:30:00.000Z'
    ])
    expect(res.code, res.stderr).toBe(0)
    // `--all-logs` inlines every child scenario's log lines, which the UI
    // run-log (and its golden) never contains — so the CLI orchestrator run
    // keeps its OWN golden next to the shared one. Regenerate explicitly
    // with UPDATE_RUNLOG_GOLDEN=1 on an intentional change.
    const cliGolden = goldenPathFor('Main').replace(/\.yaml$/, '.all-logs.yaml')
    if (process.env.UPDATE_RUNLOG_GOLDEN === '1') {
      writeFileSync(cliGolden, normalizeRunLogYaml(res.stdout))
    }
    expect(normalizeRunLogYaml(res.stdout)).toBe(normalizeRunLogYaml(readFileSync(cliGolden, 'utf-8')))
  })

  test('--out writes the run-log to a file, byte-identical to stdout', async () => {
    const project = freshProject('restorm-cli-out-')
    const outFile = `${project}.run.log`
    const res = await runCli(['--open', project, '--run', LOGS, '--all-logs', '--headless', '--out', outFile])
    expect(res.code, res.stderr).toBe(0)
    expect(readFileSync(outFile, 'utf-8')).toBe(res.stdout)
  })

  test('default (no --all-logs) emits only the user Log entries', async () => {
    const project = freshProject('restorm-cli-user-')
    const res = await runCli(['--open', project, '--run', LOGS, '--headless'])
    expect(res.code, res.stderr).toBe(0)
    // The user-only view is a strict subset of the all-logs view: every line is a
    // `message:` (no engine `start/done` debug lines, no `data:` trees).
    expect(res.stdout.length).toBeGreaterThan(0)
    expect(res.stdout).not.toContain('start log')
    expect(res.stdout).not.toContain('▶ Logs')
  })

  test('exits 2 on an unresolved scenario name', async () => {
    const project = freshProject('restorm-cli-badname-')
    const res = await runCli(['--open', project, '--run', 'Does Not Exist', '--headless'])
    expect(res.code).toBe(2)
    expect(res.stderr).toContain("no scenario named 'Does Not Exist'")
  })

  test('exits 2 when --run is given without --open', async () => {
    const res = await runCli(['--run', LOGS, '--headless'])
    expect(res.code).toBe(2)
    expect(res.stderr).toContain('--run requires --open')
  })
})
