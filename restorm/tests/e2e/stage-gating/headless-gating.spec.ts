import { test, expect } from '@playwright/test'
import { spawn } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
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
 * Tokens are minted fresh in beforeAll (via the Supabase PostgREST API, using
 * the DEV_SUPABASE_SERVICE_ROLE_KEY) and deleted in afterAll — the test is
 * fully self-contained and idempotent across runs. A throwaway community org
 * (no subscription row → Community plan) is created and torn down the same way.
 *
 * Required env vars:
 *   DEV_SUPABASE_URL              — https://ntxmtfngtfevisbylniz.supabase.co
 *   DEV_SUPABASE_SERVICE_ROLE_KEY — dev project service_role JWT
 *   RESTORM_E2E_BACKEND_VERSION   — set to '0.0.0-preview' pins the dev channel
 *                                   (handled automatically in runHeadless)
 */

const MAIN_JS = join(process.cwd(), 'dist/main/index.js')
const ELECTRON = electronPath as unknown as string

/** A leaf scenario in the reference project (offline call-history replay). */
const SCENARIO = 'Auth Service/Pet API/Main/Logs'

/** The seeded Pro org on dev. Its subscription row is pre-existing and must NOT
 * be modified by this test — only a cli_token row is added and deleted. */
const DEV_PRO_ORG_ID = 'dbd056c0-9269-4b09-aaf4-2fb0a960326a'

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

/** Generate a random `rstk_` token + its SHA-256 hex hash (the value stored in
 * `cli_tokens.token_hash`). The token itself is never committed — it lives only
 * in memory for the duration of the test run. */
function mintToken(): { token: string; hash: string } {
  const token = `rstk_${randomBytes(24).toString('base64url')}`
  const hash = createHash('sha256').update(token, 'utf8').digest('hex')
  return { token, hash }
}

/** POST a row into a Supabase table via PostgREST (service_role bypasses RLS). */
async function sbInsert(url: string, key: string, table: string, row: object): Promise<Response> {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  })
  if (!res.ok) throw new Error(`Supabase INSERT ${table}: ${res.status} ${await res.text()}`)
  return res
}

/** GET rows from a Supabase table via PostgREST (PostgREST filter syntax). */
async function sbGet<T>(url: string, key: string, table: string, filter: string): Promise<T[]> {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  })
  if (!res.ok) throw new Error(`Supabase GET ${table}?${filter}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T[]>
}

/** DELETE rows from a Supabase table via PostgREST (PostgREST filter syntax). */
async function sbDelete(url: string, key: string, table: string, filter: string): Promise<void> {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  })
  if (!res.ok) throw new Error(`Supabase DELETE ${table}?${filter}: ${res.status} ${await res.text()}`)
}

test.describe.configure({ mode: 'serial' })

test.describe('headless CLI entitlement gating (dev backend)', () => {
  let project: string
  let proToken: string
  let proTokenHash: string
  let communityToken: string
  let communityTokenHash: string
  let communityOrgId: string

  test.beforeAll(async () => {
    const supabaseUrl = process.env.DEV_SUPABASE_URL
    const serviceRoleKey = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'DEV_SUPABASE_URL and DEV_SUPABASE_SERVICE_ROLE_KEY must be set — ' +
        'headless-gating mints + cleans up tokens on the real dev backend'
      )
    }

    project = setupReferenceWorkingCopy(mkdtempSync(join(tmpdir(), 'restorm-headless-gating-')))

    // --- Idempotency sweep: clean up any orphans from a prior crashed run -------
    // If a previous run died before afterAll the orphan rows block this INSERT
    // (unique token_hash, or a (org_id, name) constraint). Pre-delete by stable
    // (org_id, name) so each run starts from a clean slate regardless.

    // Pro token: stable (org_id, name=e2e-210-pro) — delete any leftover.
    await sbDelete(supabaseUrl, serviceRoleKey, 'cli_tokens',
      `org_id=eq.${DEV_PRO_ORG_ID}&name=eq.e2e-210-pro`)

    // Throwaway community orgs: name is stable; sweep their tokens then the orgs.
    const orphanOrgs = await sbGet<{ id: string }>(
      supabaseUrl, serviceRoleKey, 'organizations', 'name=eq.e2e-210-community-throwaway'
    )
    for (const org of orphanOrgs) {
      await sbDelete(supabaseUrl, serviceRoleKey, 'cli_tokens', `org_id=eq.${org.id}`)
    }
    if (orphanOrgs.length > 0) {
      await sbDelete(supabaseUrl, serviceRoleKey, 'organizations', 'name=eq.e2e-210-community-throwaway')
    }
    // ---------------------------------------------------------------------------

    // Mint a fresh token for the dev Pro org. The token_hash is what is stored;
    // the raw token string is kept in memory and provided to runHeadless.
    const pro = mintToken()
    proToken = pro.token
    proTokenHash = pro.hash
    await sbInsert(supabaseUrl, serviceRoleKey, 'cli_tokens', {
      org_id: DEV_PRO_ORG_ID,
      name: 'e2e-210-pro',
      token_hash: proTokenHash
    })

    // Create a throwaway community org (no subscription row → Community plan).
    const communityRes = await sbInsert(supabaseUrl, serviceRoleKey, 'organizations', {
      name: 'e2e-210-community-throwaway',
      workos_org_id: `e2e:org_${randomBytes(8).toString('hex')}`
    })
    const communityOrg = (await communityRes.json()) as { id: string }[]
    communityOrgId = communityOrg[0].id

    // Mint a fresh token for the throwaway community org.
    const community = mintToken()
    communityToken = community.token
    communityTokenHash = community.hash
    await sbInsert(supabaseUrl, serviceRoleKey, 'cli_tokens', {
      org_id: communityOrgId,
      name: 'e2e-210-community',
      token_hash: communityTokenHash
    })
  })

  test.afterAll(async () => {
    const supabaseUrl = process.env.DEV_SUPABASE_URL
    const serviceRoleKey = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) return

    // Delete tokens first (FK: cli_tokens → organizations), then the throwaway org.
    if (proTokenHash) await sbDelete(supabaseUrl, serviceRoleKey, 'cli_tokens', `token_hash=eq.${proTokenHash}`)
    if (communityTokenHash) await sbDelete(supabaseUrl, serviceRoleKey, 'cli_tokens', `token_hash=eq.${communityTokenHash}`)
    if (communityOrgId) await sbDelete(supabaseUrl, serviceRoleKey, 'organizations', `id=eq.${communityOrgId}`)

    // Remove the temp project copy.
    if (project) rmSync(project, { recursive: true, force: true })
  })

  test('a PRO-org token grants scenario.headless — the run succeeds', async () => {
    const res = await runHeadless(project, proToken)
    expect(res.code, `expected exit 0, got ${String(res.code)}\nstderr: ${res.stderr}`).toBe(0)
    expect(res.stdout.length).toBeGreaterThan(0)
  })

  test('a COMMUNITY-org token is refused — plan does not grant scenario.headless', async () => {
    const res = await runHeadless(project, communityToken)
    // The gate-proving assertion: auth SUCCEEDED (valid token) but the PLAN refused.
    expect(res.code, `expected exit 3 (plan-insufficient), got ${String(res.code)}\nstderr: ${res.stderr}`).toBe(3)
    expect(res.stderr).toMatch(/Pro or Enterprise/i)
    expect(res.stderr).toMatch(/scenario\.headless/)
  })

  test('no token is refused with the token-missing guidance', async () => {
    const res = await runHeadless(project, undefined)
    expect(res.code, `expected exit 3 (token-missing), got ${String(res.code)}\nstderr: ${res.stderr}`).toBe(3)
    expect(res.stderr).toMatch(/require a Restorm Pro plan and a CI token/i)
  })

  test('a bogus token is refused', async () => {
    const res = await runHeadless(project, 'rstk_this-is-not-a-real-token')
    expect(res.code, `expected exit 3 (token-invalid/fetch-error), got ${String(res.code)}\nstderr: ${res.stderr}`).toBe(3)
    expect(res.stderr.length).toBeGreaterThan(0)
  })
})
