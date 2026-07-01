import { test, expect } from '@playwright/test'
import { spawn } from 'child_process'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import electronPath from 'electron'
import { setupReferenceWorkingCopy } from '../bdd/scenario-runlog/runLogShared'

/**
 * STAGE-ONLY headless entitlement-gating e2e — the CLI-token (`rstk_…`) path,
 * which is DISTINCT from the interactive login (see gating-lifecycle.spec.ts).
 * Runs against the REAL dev backend, so it lives in the `RESTORM_E2E_STAGE=1`
 * project and never runs in the per-PR / pre-push suite.
 *
 * A `restorm --headless --run <scenario>` invocation gates on the
 * `scenario.headless` capability, resolved by presenting `RESTORM_TOKEN` (an
 * org-scoped `rstk_…` PAT) to the dev `entitlement` Edge Function. This proves
 * the gate end-to-end:
 *   - a token for a PRO org  → capability granted → the run succeeds (exit 0);
 *   - a token for a COMMUNITY org (auth OK, plan too low) → refused (exit 3,
 *     "Pro or Enterprise") — the case that proves the PLAN gates, not just auth;
 *   - no token / a bogus token → refused (exit 3).
 *
 * Tokens are minted once on dev (persisted in `cli_tokens`) and provided via the
 * environment so no secret is committed. `RESTORM_E2E_BACKEND_VERSION` pins the
 * dev/preview channel (the unpackaged build can't read the `-preview` version).
 */

const MAIN_JS = join(process.cwd(), 'dist/main/index.js')
const ELECTRON = electronPath as unknown as string

/** A leaf scenario in the reference project (offline call-history replay). */
const SCENARIO = 'Auth Service/Pet API/Main/Logs'

interface CliResult { code: number | null; stdout: string; stderr: string }

/** Spawn the built app headless with an optional RESTORM_TOKEN and return its
 * exit code + streams. Never seeds RESTORM_E2E_ENTITLEMENT_PLAN — this test
 * exercises the REAL token gate. */
function runHeadless(project: string, token: string | undefined): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.RESTORM_E2E_ENTITLEMENT_PLAN // never bypass the gate we are testing
  env.TZ = 'UTC'
  env.NODE_ENV = 'development'
  // Pin the dev/preview channel so the entitlement fetch hits dev, not prod.
  env.RESTORM_E2E_BACKEND_VERSION = '0.0.0-preview'
  if (token !== undefined) env.RESTORM_TOKEN = token
  else delete env.RESTORM_TOKEN

  return new Promise((resolve, reject) => {
    const child = spawn(
      ELECTRON,
      ['--no-sandbox', '--ozone-platform=x11', MAIN_JS, '--open', project, '--run', SCENARIO, '--all-logs', '--headless'],
      { env }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', (code) => { resolve({ code, stdout, stderr }) })
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('headless CLI entitlement gating (dev backend)', () => {
  const proToken = process.env.RESTORM_HEADLESS_PRO_TOKEN
  const communityToken = process.env.RESTORM_HEADLESS_COMMUNITY_TOKEN
  let project: string

  test.beforeAll(() => {
    if (proToken === undefined || proToken === '' || communityToken === undefined || communityToken === '') {
      throw new Error(
        'RESTORM_HEADLESS_PRO_TOKEN and RESTORM_HEADLESS_COMMUNITY_TOKEN must be set ' +
        '(rstk_ tokens minted on the dev Pro and community orgs) — stage-gating hits the real dev backend'
      )
    }
    project = setupReferenceWorkingCopy(mkdtempSync(join(tmpdir(), 'restorm-headless-gating-')))
  })

  test('a PRO-org token grants scenario.headless — the run succeeds', async () => {
    const res = await runHeadless(project, proToken)
    expect(res.code, `expected exit 0, got ${String(res.code)}\nstderr: ${res.stderr}`).toBe(0)
    expect(res.stdout.length).toBeGreaterThan(0)
  })

  test('a COMMUNITY-org token is refused — plan does not grant scenario.headless', async () => {
    const res = await runHeadless(project, communityToken)
    expect(res.code, `expected non-zero exit, got ${String(res.code)}`).not.toBe(0)
    // The gate-proving assertion: auth SUCCEEDED (valid token) but the PLAN refused.
    expect(res.stderr).toMatch(/Pro or Enterprise/i)
    expect(res.stderr).toMatch(/scenario\.headless/)
  })

  test('no token is refused with the token-missing guidance', async () => {
    const res = await runHeadless(project, undefined)
    expect(res.code, `expected non-zero exit, got ${String(res.code)}`).not.toBe(0)
    expect(res.stderr).toMatch(/require a Restorm Pro plan and a CI token/i)
  })

  test('a bogus token is refused', async () => {
    const res = await runHeadless(project, 'rstk_this-is-not-a-real-token')
    expect(res.code, `expected non-zero exit, got ${String(res.code)}`).not.toBe(0)
    expect(res.stderr.length).toBeGreaterThan(0)
  })
})
