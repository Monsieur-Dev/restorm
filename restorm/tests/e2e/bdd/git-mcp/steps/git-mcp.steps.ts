import { createBdd } from 'playwright-bdd'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { test, expect, type McpDiscovery, type McpToolReply } from '../../fixtures/git-mcp.fixture'
import { gitServerUrlFor, gitEnv } from '../../../../integration/gitServerSeed'
import { readSeedDocument, findEntity, setEntityField, gitCommit, gitPush } from '../../../helpers/gitSeedHelpers'

const { Given, When, Then } = createBdd(test)

let discovery: McpDiscovery | null = null
let activeRepoName: string | null = null
let localCloneDir: string | null = null
let localFilePath: string | null = null
let headBeforeCommit: string | null = null
let reviewToken: string | null = null
let resolutionToken: string | null = null
let conflictIds: string[] = []
let lastReply: Record<string, unknown> | null = null

const LOCAL_AUTHOR = { email: 'e2e@restorm.test', name: 'Restorm E2E' }
const COLLABORATOR_AUTHOR = { email: 'collaborator@restorm.test', name: 'Other Collaborator' }
const MCP_EDITED_URL = 'https://mcp-edited.example.com/pets/1'

function requireDiscovery(): McpDiscovery {
  if (!discovery) throw new Error('app must be launched via MCP before calling tools')
  return discovery
}

function requireLocalCloneDir(): string {
  if (!localCloneDir) throw new Error('no local clone — a "Given ..." step must run first')
  return localCloneDir
}

function requireReviewToken(): string {
  if (!reviewToken) throw new Error('no review token — call git_commit_push first')
  return reviewToken
}

function requireResolutionToken(): string {
  if (!resolutionToken) throw new Error('no resolution token — call git_pull first')
  return resolutionToken
}

function requireLastReply(): Record<string, unknown> {
  if (!lastReply) throw new Error('no MCP tool reply recorded yet')
  return lastReply
}

/** MCP tool replies wrap their JSON payload as `content[0].text` (see
 * `jsonReply()` in `src/main/mcp/tools/git.ts`) — same parsing convention
 * `mcp-server.steps.ts` already uses for its own tool replies. */
function parsedReply(reply: McpToolReply): Record<string, unknown> {
  const text = reply.content?.[0]?.text ?? ''
  try { return JSON.parse(text) as Record<string, unknown> } catch { return { raw: text } }
}

function headOf(dir: string): string {
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8', env: gitEnv() }).trim()
}

// ---------------------------------------------------------------------------
// Scenario 1 — the 2-step commit+push flow
// ---------------------------------------------------------------------------

Given('a project cloned from a freshly seeded git remote, with an uncommitted change to the request\'s URL on disk, is open via MCP', async ({ seedFreshRepo, launchAppWithMcp, callMcpTool }) => {
  activeRepoName = `git-mcp-commit-${Date.now()}`
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)
  headBeforeCommit = headOf(localCloneDir)

  // Seed the change directly on disk, uncommitted, BEFORE opening. The git
  // MCP routes stage/commit the actual working-tree file (GitService.stage
  // runs `git add` on disk, not on an in-memory model), so the honest setup
  // for a git-route test is "a real uncommitted change already sitting on
  // disk" — the same way git-conflict/git-push-pull seed theirs. Opening
  // the project after this loads the already-edited working tree straight
  // into memory, so no MCP write round-trip is needed to exercise these
  // routes (an MCP write's own persistence has its own, separate, coverage).
  setEntityField(localCloneDir, 'e2e-seed-request', 'url', MCP_EDITED_URL)

  const launched = await launchAppWithMcp()
  discovery = launched.discovery

  const reply = await callMcpTool(discovery, 'open_project', { filePath: localFilePath })
  const parsed = parsedReply(reply)
  expect(parsed['opened']).toBe(true)
})

When('I call git_commit_push over MCP', async ({ callMcpTool }) => {
  const reply = await callMcpTool(requireDiscovery(), 'git_commit_push', {})
  lastReply = parsedReply(reply)
})

Then('it returns a review token and a generated commit title, with nothing committed yet', () => {
  const reply = requireLastReply()
  expect(reply['hasChanges']).toBe(true)
  expect(typeof reply['reviewToken']).toBe('string')
  expect(reply['reviewToken']).not.toBe('')
  expect(typeof reply['title']).toBe('string')
  expect(reply['title']).not.toBe('')
  reviewToken = reply['reviewToken'] as string

  // Ground truth: git_commit_push only computes+returns a diff preview —
  // nothing is staged/committed until git_confirm_push runs.
  expect(headOf(requireLocalCloneDir())).toBe(headBeforeCommit)
})

When('I call git_confirm_push with that review token over MCP', async ({ callMcpTool }) => {
  const reply = await callMcpTool(requireDiscovery(), 'git_confirm_push', { reviewToken: requireReviewToken() })
  lastReply = parsedReply(reply)
})

Then('the change is committed locally and pushed to the remote', ({ gitIntegrationRoot }) => {
  const reply = requireLastReply()
  expect(reply['committed']).toBe(true)
  expect(reply['pushed']).toBe(true)

  const dir = requireLocalCloneDir()
  // Ground truth #1: the local clone's HEAD actually moved.
  expect(headOf(dir)).not.toBe(headBeforeCommit)

  // Ground truth #2: a FRESH, independent clone (not the session that made
  // the change) sees the edit on the remote — the real proof the push
  // landed, same rigor as wave 1/2's push scenarios.
  if (!activeRepoName) throw new Error('no active repo')
  const verifyDir = join(gitIntegrationRoot, 'git-mcp-commit-verify')
  execSync(`git clone "${gitServerUrlFor(activeRepoName)}" "${verifyDir}"`, { stdio: 'ignore', env: gitEnv() })
  const doc = readSeedDocument(verifyDir)
  const entity = findEntity(doc.collections, 'e2e-seed-request')
  expect(entity?.['url']).toBe(MCP_EDITED_URL)
})

// ---------------------------------------------------------------------------
// Scenario 2 — a conflicted pull, resolved via MCP
// ---------------------------------------------------------------------------

Given('a remote has diverged on the request between my clone and a collaborator\'s', async ({ seedFreshRepo, cloneNamedRepo }) => {
  activeRepoName = `git-mcp-conflict-${Date.now()}`
  localFilePath = await seedFreshRepo(activeRepoName)
  localCloneDir = dirname(localFilePath)

  // My own LOCAL commit — never pushed (mirrors git-conflict.steps.ts's
  // abort-merge setup: the simplest real-conflict shape, one entity).
  setEntityField(localCloneDir, 'e2e-seed-request', 'url', 'https://mcp-local.example.com/pets/1')
  gitCommit(localCloneDir, LOCAL_AUTHOR, 'My local edit to the request URL')

  const collaboratorDir = await cloneNamedRepo(activeRepoName, 'git-mcp-conflict-collaborator')
  setEntityField(collaboratorDir, 'e2e-seed-request', 'url', 'https://mcp-collaborator.example.com/pets/1')
  gitCommit(collaboratorDir, COLLABORATOR_AUTHOR, 'Collaborator edit to the request URL')
  gitPush(collaboratorDir)
})

Given('that project is open via MCP', async ({ launchAppWithMcp, callMcpTool }) => {
  if (!localFilePath) throw new Error('no local clone — the "Given a remote has diverged..." step must run first')
  const launched = await launchAppWithMcp()
  discovery = launched.discovery

  const reply = await callMcpTool(discovery, 'open_project', { filePath: localFilePath })
  const parsed = parsedReply(reply)
  expect(parsed['opened']).toBe(true)
})

When('I call git_pull over MCP', async ({ callMcpTool }) => {
  const reply = await callMcpTool(requireDiscovery(), 'git_pull', {})
  lastReply = parsedReply(reply)
})

Then('it returns a resolution token and the conflict list, without completing the merge', () => {
  const reply = requireLastReply()
  expect(reply['pulled']).toBe(false)
  expect(reply['conflicted']).toBe(true)
  expect(typeof reply['resolutionToken']).toBe('string')
  expect(reply['resolutionToken']).not.toBe('')
  resolutionToken = reply['resolutionToken'] as string

  const conflicts = reply['conflicts']
  if (!Array.isArray(conflicts) || conflicts.length !== 1) {
    throw new Error(`expected exactly 1 conflict (the request), got ${JSON.stringify(conflicts)}`)
  }
  conflictIds = conflicts.map((c: { id: string }) => c.id)

  // Ground truth: the local clone is genuinely mid-merge.
  expect(existsSync(join(requireLocalCloneDir(), '.git', 'MERGE_HEAD'))).toBe(true)
})

When('I call git_resolve_conflicts picking my own version for every conflict over MCP', async ({ callMcpTool }) => {
  const resolutions = conflictIds.map((id) => ({ id, pick: 'ours' }))
  const reply = await callMcpTool(requireDiscovery(), 'git_resolve_conflicts', {
    resolutionToken: requireResolutionToken(),
    resolutions
  })
  lastReply = parsedReply(reply)
})

Then('the merge is committed locally with my version of the content', () => {
  const reply = requireLastReply()
  expect(reply['resolved']).toBe(true)

  const dir = requireLocalCloneDir()
  // Ground truth #1: the merge actually completed (no more MERGE_HEAD).
  expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(false)
  // Ground truth #2: the resolved content on disk reflects "ours" — the
  // pick this scenario made for the single conflict.
  const doc = readSeedDocument(dir)
  const entity = findEntity(doc.collections, 'e2e-seed-request')
  expect(entity?.['url']).toBe('https://mcp-local.example.com/pets/1')
})
