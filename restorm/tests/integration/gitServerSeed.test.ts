import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isGitServerSeeded, seedGitServer, seedFreshRepo, resetGitServerSeed, gitEnv, GIT_SERVER_URL, SEED_REPO_NAME } from './gitServerSeed'

const BARE_REPO_PATH = join(__dirname, '../docker/git-server/repos', SEED_REPO_NAME)

// No docker involved — `seedGitServer` is pure host-side git CLI + filesystem
// against the SAME bind-mounted path the `git-server` container also serves.
// This test proves the seeding logic itself is correct; the container's role
// (serving that same directory over git://) is exercised by the e2e suite.
//
// Every `execSync` here passes `{ env: gitEnv() }` for the same reason
// `gitServerSeed.ts`'s own `run()` does: when this file runs under the
// pre-commit/pre-push hook (as `test:all` does), the hook has exported
// `GIT_DIR`/`GIT_INDEX_FILE` into this process's environment, and an
// un-scrubbed `git -C <bare> ...` would read/write the WORKTREE instead of
// the bare repo path it was explicitly pointed at — corrupting both the
// setup AND the assertions in this file, not just `seedGitServer` itself.
//
// `isGitServerSeeded`/`seedGitServer` check REAL FILESYSTEM state at the
// default `REPOS_DIR` — the same bind-mounted directory the e2e suite's
// `global-setup.ts` unconditionally seeds on every `pnpm test:e2e` run. No
// amount of test-runner process/module isolation protects against that: an
// e2e run on this host any time before `test:all` leaves `seed-project.git`
// sitting there, and "is not seeded before the first call" would fail on a
// dirty start it has no way to detect. Reset BEFORE every test too (not
// just after) so this suite is self-contained regardless of what ran on
// this host earlier.
beforeEach(() => { resetGitServerSeed() })
afterEach(() => { resetGitServerSeed() })

describe('gitServerSeed', () => {
  it('is not seeded before the first call', () => {
    expect(isGitServerSeeded()).toBe(false)
  })

  it('creates a bare repo with a seed commit on the main branch', () => {
    seedGitServer()
    expect(isGitServerSeeded()).toBe(true)
    expect(existsSync(BARE_REPO_PATH)).toBe(true)

    const branch = execSync(`git -C "${BARE_REPO_PATH}" symbolic-ref --short HEAD`, { encoding: 'utf-8', env: gitEnv() }).trim()
    expect(branch).toBe('main')

    const log = execSync(`git -C "${BARE_REPO_PATH}" log --oneline`, { encoding: 'utf-8', env: gitEnv() })
    expect(log).toContain('Seed project')
  })

  it('the seed commit contains a valid single-file project with the seeded entities', () => {
    seedGitServer()
    const rawYaml = execSync(`git -C "${BARE_REPO_PATH}" show main:api.restorm`, { encoding: 'utf-8', env: gitEnv() })
    expect(rawYaml).toContain('_projectUuid:')
    expect(rawYaml).toContain('folderType: environment')
    expect(rawYaml).toContain('Find pet by ID')
  })

  it('is idempotent — a second call is a no-op on an already-seeded repo', () => {
    seedGitServer()
    const firstLog = execSync(`git -C "${BARE_REPO_PATH}" log --oneline`, { encoding: 'utf-8', env: gitEnv() })
    seedGitServer()
    const secondLog = execSync(`git -C "${BARE_REPO_PATH}" log --oneline`, { encoding: 'utf-8', env: gitEnv() })
    expect(secondLog).toBe(firstLog)
  })

  it('resetGitServerSeed wipes the repo so the next call re-seeds from scratch', () => {
    seedGitServer()
    resetGitServerSeed()
    expect(isGitServerSeeded()).toBe(false)
  })

  it('exposes a clone URL matching the seeded repo name', () => {
    expect(GIT_SERVER_URL).toBe(`git://localhost:9418/${SEED_REPO_NAME}`)
  })
})

describe('gitServerSeed isolation — must never touch an enclosing git repo via a hook env leak', () => {
  // Regression guard for the REAL incident cause (see gitServerSeed.ts's doc
  // comment): a git HOOK (pre-commit/pre-push) exports `GIT_DIR` +
  // `GIT_INDEX_FILE` into its environment; `test:all` runs from that hook, so
  // every `git` subprocess in this process inherits them — and git uses those
  // env vars OVER any `-C`/cwd/path passed to it. `git -C <bare> symbolic-ref
  // HEAD` returned the WORKTREE's branch in the real incident, and `git add`
  // + `git commit` in the seed's workdir committed the WORKTREE's staged
  // index (17 files) under the seed's author/message, regardless of where
  // the workdir physically lived (moving it to `tmpdir()` did NOT stop this —
  // that was a red herring; only scrubbing `GIT_*` env does). This test
  // reproduces the exact hook condition — setting `GIT_DIR`/`GIT_INDEX_FILE`
  // on `process.env` to point at a throwaway "enclosing" repo — WITHOUT
  // needing a real hook, then asserts the throwaway repo's HEAD is unchanged
  // and its staged file is still staged, never committed away.
  it('never commits into a repo pointed to by a leaked GIT_DIR/GIT_INDEX_FILE env', () => {
    const enclosingRepo = mkdtempSync(join(tmpdir(), 'restorm-git-seed-isolation-test-'))
    const reposDir = mkdtempSync(join(tmpdir(), 'restorm-git-seed-isolation-repos-'))
    const savedGitDir = process.env.GIT_DIR
    const savedGitIndexFile = process.env.GIT_INDEX_FILE
    try {
      execSync('git init -b main', { cwd: enclosingRepo, stdio: 'ignore', env: gitEnv() })
      writeFileSync(join(enclosingRepo, 'committed.txt'), 'first commit\n', 'utf-8')
      execSync('git add committed.txt', { cwd: enclosingRepo, stdio: 'ignore', env: gitEnv() })
      execSync('git -c user.email=enclosing@test -c user.name="Enclosing Repo" commit -m "Initial commit"', { cwd: enclosingRepo, stdio: 'ignore', env: gitEnv() })

      // Dirty + STAGED — the exact state the real incident escalated onto.
      writeFileSync(join(enclosingRepo, 'staged.txt'), 'should never be committed\n', 'utf-8')
      execSync('git add staged.txt', { cwd: enclosingRepo, stdio: 'ignore', env: gitEnv() })

      const headBefore = execSync('git rev-parse HEAD', { cwd: enclosingRepo, encoding: 'utf-8', env: gitEnv() }).trim()

      // Simulate exactly what a git HOOK exports into a spawned process's
      // environment — the actual incident trigger, not directory nesting.
      process.env.GIT_DIR = join(enclosingRepo, '.git')
      process.env.GIT_INDEX_FILE = join(enclosingRepo, '.git', 'index')

      seedFreshRepo('isolation-test-repo', reposDir)

      const headAfter = execSync('git rev-parse HEAD', { cwd: enclosingRepo, encoding: 'utf-8', env: gitEnv() }).trim()
      const statusAfter = execSync('git status --porcelain', { cwd: enclosingRepo, encoding: 'utf-8', env: gitEnv() })

      expect(headAfter).toBe(headBefore)
      expect(statusAfter).toContain('A  staged.txt')
    } finally {
      if (savedGitDir === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = savedGitDir
      if (savedGitIndexFile === undefined) delete process.env.GIT_INDEX_FILE
      else process.env.GIT_INDEX_FILE = savedGitIndexFile
      rmSync(enclosingRepo, { recursive: true, force: true })
      rmSync(reposDir, { recursive: true, force: true })
    }
  })
})
