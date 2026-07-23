/**
 * Host-side seeding for the `git-server` docker mock (see tests/docker/
 * docker-compose.yml). The container only runs `git daemon` over a
 * bind-mounted directory — it has no notion of "repos" or "seed data" on
 * its own. Seeding therefore happens on the HOST, with the host's own git
 * CLI operating directly on the bind-mounted path (`tests/docker/
 * git-server/repos/`), the same directory the container serves over
 * git://. No `docker exec` needed: the mount makes it the same filesystem
 * from both sides.
 *
 * Idempotent — a re-run (second `pnpm test:e2e` on an already-seeded host)
 * is a no-op, since the bare repo already exists.
 *
 * The ephemeral CLONE workdir (used to write + commit + push the seed
 * content into the bare repo) lives in the OS temp dir, NOT under
 * `REPOS_DIR` — kept as secondary hygiene, but NOT the real fix (see
 * below).
 *
 * REAL incident cause: a git HOOK (pre-commit/pre-push) exports `GIT_DIR`
 * + `GIT_INDEX_FILE` (+ `GIT_WORK_TREE`) into its environment; vitest run
 * from that hook inherits them, and every `git` subprocess then uses
 * those env vars OVER any `-C`/cwd/path passed to it — `git -C <bare>
 * symbolic-ref HEAD` returned the WORKTREE's branch, and `git add` +
 * `git commit` here operated on the WORKTREE's index regardless of where
 * the workdir physically lived. `gitEnv()` strips every `GIT_*` var
 * before each invocation so this process's git commands are immune to
 * whatever a wrapping hook exported.
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Strip every `GIT_*` env var (GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE/
 * GIT_OBJECT_DIRECTORY/GIT_COMMON_DIR/GIT_CEILING_DIRECTORIES/...) so a
 * git subprocess can't be redirected onto whatever repo a wrapping git
 * HOOK (pre-commit/pre-push) exported into this process's environment —
 * see this module's doc comment. Safe here: user.email/name are set via
 * inline `-c`, never via env. */
export function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
}

const REPOS_DIR = join(__dirname, '../docker/git-server/repos')
export const SEED_REPO_NAME = 'seed-project.git'

/** The clone URL the e2e suite's git-remote fixture hands to restorm for
 * the SHARED, read-only seed repo — the same bind-mounted path, served by
 * the `git-server` container over :9418. */
export const GIT_SERVER_URL = `git://localhost:9418/${SEED_REPO_NAME}`

/** v1 targets the repo's DEFAULT branch (no branch management yet — see
 * docs/Git/README.md) — pinned to `main` explicitly so seeding is
 * deterministic across hosts/CI regardless of the local `init.defaultBranch`. */
const DEFAULT_BRANCH = 'main'

/**
 * A single-file Restorm project with one of each conflictable entity kind
 * (`GitEntityKind` — see `restorm/src/shared/git/gitCommitDiff.ts`): the
 * environment folder itself, a plain folder, the request, and a scenario.
 * Wave 1 only ever touches the request; wave 2's conflict suite (AC#5,
 * "conflict coverage across ALL element types") needs real material for
 * the other three too, so every entity is here from the start rather than
 * added later — one shared seed shape for both waves.
 */
const SEED_PROJECT_YAML = `_projectUuid: e2e-seed-project-uuid
collections:
  - id: e2e-seed-env-folder
    name: Seed Project
    tags: []
    configuration: {}
    folderType: environment
    environments: []
    fileFormatVersion: 1
    items:
      - id: e2e-seed-request
        name: Find pet by ID
        type: http
        tags: []
        method: GET
        url: https://petstore.example.com/pets/1
        headers: []
        params: []
        pathParams: []
  - id: e2e-seed-folder
    name: Legacy Endpoints
    tags: []
    configuration: {}
    items: []
  - id: e2e-seed-scenario
    name: Smoke Test
    type: scenario
    tags: []
    params: []
    nodes: []
    edges: []
`

function run(command: string, cwd?: string): void {
  execSync(command, { cwd, stdio: 'ignore', env: gitEnv() })
}

function bareRepoPathFor(reposDir: string, repoFileName: string): string {
  return join(reposDir, repoFileName)
}

function seedRepoAt(reposDir: string, bareRepoPath: string): void {
  mkdirSync(reposDir, { recursive: true })
  run(`git init --bare -b ${DEFAULT_BRANCH} "${bareRepoPath}"`)

  // OS temp dir, deliberately OUTSIDE reposDir/this repo's working tree —
  // see this module's own doc comment for why.
  const workDir = mkdtempSync(join(tmpdir(), 'restorm-git-seed-'))
  try {
    run(`git clone "${bareRepoPath}" "${workDir}"`)
    writeFileSync(join(workDir, 'api.restorm'), SEED_PROJECT_YAML, 'utf-8')
    run('git add api.restorm', workDir)
    run(`git -c user.email=e2e@restorm.test -c user.name="Restorm E2E" commit -m "Seed project"`, workDir)
    run(`git push origin ${DEFAULT_BRANCH}`, workDir)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

/** `reposDir` is injectable (defaults to the real bind-mounted path) so
 * tests can point every function at a throwaway directory instead of the
 * real docker mount — see `gitServerSeed.test.ts`'s isolation guard test. */
export function isGitServerSeeded(reposDir: string = REPOS_DIR): boolean {
  return existsSync(bareRepoPathFor(reposDir, SEED_REPO_NAME))
}

export function seedGitServer(reposDir: string = REPOS_DIR): void {
  if (isGitServerSeeded(reposDir)) return
  seedRepoAt(reposDir, bareRepoPathFor(reposDir, SEED_REPO_NAME))
}

/** Test-only: wipe the seed repo so a test can re-seed from a clean slate
 * (e.g. after a suite that intentionally corrupts the remote). */
export function resetGitServerSeed(reposDir: string = REPOS_DIR): void {
  rmSync(bareRepoPathFor(reposDir, SEED_REPO_NAME), { recursive: true, force: true })
}

/**
 * The clone URL for a repo named `repoName` (WITHOUT the `.git` suffix —
 * added here, mirroring `SEED_REPO_NAME`'s own convention).
 */
export function gitServerUrlFor(repoName: string): string {
  return `git://localhost:9418/${repoName}.git`
}

/**
 * Seed a FRESH, independently-named bare repo — always re-created (unlike
 * `seedGitServer`, which is idempotent-skip on the single shared seed repo).
 * Scenarios that MUTATE the remote (push, or a collaborator pushing a
 * conflicting change) must call this instead of sharing `seed-project.git`
 * with every other scenario — the shared repo is fine for READ-ONLY
 * scenarios (e.g. "detect repo" status checks) but two mutating scenarios
 * racing/interleaving on the SAME remote is real cross-test contamination,
 * not a hypothetical: it's what caused the first live run of the push/pull
 * suite to fail on stale collaborator-renamed content.
 */
export function seedFreshRepo(repoName: string, reposDir: string = REPOS_DIR): string {
  const bareRepoPath = bareRepoPathFor(reposDir, `${repoName}.git`)
  rmSync(bareRepoPath, { recursive: true, force: true })
  seedRepoAt(reposDir, bareRepoPath)
  return gitServerUrlFor(repoName)
}

/**
 * Create a FRESH, completely EMPTY bare repo (no seed commit, unborn
 * `main`) — the "brand-new shared remote" starting point of collaborative
 * scenarios where the FIRST push comes from the app itself, not from the
 * harness. Always re-created, same contamination rationale as
 * `seedFreshRepo`.
 */
export function createEmptyRemote(repoName: string, reposDir: string = REPOS_DIR): string {
  const bareRepoPath = bareRepoPathFor(reposDir, `${repoName}.git`)
  rmSync(bareRepoPath, { recursive: true, force: true })
  mkdirSync(reposDir, { recursive: true })
  run(`git init --bare -b ${DEFAULT_BRANCH} "${bareRepoPath}"`)
  return gitServerUrlFor(repoName)
}
