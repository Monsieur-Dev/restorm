import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isGitServerSeeded, seedGitServer, seedFreshRepo, resetGitServerSeed, resolveReposDir, gitEnv, gitServerUrl, SEED_REPO_NAME } from './gitServerSeed'

// Every call below injects this throwaway directory. The DEFAULT is the
// directory the git-server container is actually serving (see
// `resolveReposDir`), which a concurrent e2e run may be mid-clone against —
// and `resetGitServerSeed` would delete its seed out from under it. Nothing
// here may touch the real mount.
let reposDir: string
let bareRepoPath: string

// No docker involved — `seedGitServer` is pure host-side git CLI + filesystem
// against a bind-mounted path; here we point it at a throwaway one. This test
// proves the seeding logic itself is correct; the container's role (serving
// that directory over git://) is exercised by the e2e suite.
//
// Every `execSync` here passes `{ env: gitEnv() }` for the same reason
// `gitServerSeed.ts`'s own `run()` does: when this file runs under the
// pre-commit/pre-push hook (as `test:all` does), the hook has exported
// `GIT_DIR`/`GIT_INDEX_FILE` into this process's environment, and an
// un-scrubbed `git -C <bare> ...` would read/write the WORKTREE instead of
// the bare repo path it was explicitly pointed at — corrupting both the
// setup AND the assertions in this file, not just `seedGitServer` itself.
//
// A fresh directory per test also makes "is not seeded before the first
// call" honest: it can no longer be perturbed by whatever an earlier e2e run
// on this host left behind in the real mount.
beforeEach(() => {
  reposDir = mkdtempSync(join(tmpdir(), 'restorm-git-seed-unit-'))
  bareRepoPath = join(reposDir, SEED_REPO_NAME)
})
afterEach(() => { rmSync(reposDir, { recursive: true, force: true }) })

describe('gitServerSeed', () => {
  it('is not seeded before the first call', () => {
    expect(isGitServerSeeded(reposDir)).toBe(false)
  })

  it('creates a bare repo with a seed commit on the main branch', () => {
    seedGitServer(reposDir)
    expect(isGitServerSeeded(reposDir)).toBe(true)
    expect(existsSync(bareRepoPath)).toBe(true)

    const branch = execSync(`git -C "${bareRepoPath}" symbolic-ref --short HEAD`, { encoding: 'utf-8', env: gitEnv() }).trim()
    expect(branch).toBe('main')

    const log = execSync(`git -C "${bareRepoPath}" log --oneline`, { encoding: 'utf-8', env: gitEnv() })
    expect(log).toContain('Seed project')
  })

  it('the seed commit contains a valid single-file project with the seeded entities', () => {
    seedGitServer(reposDir)
    const rawYaml = execSync(`git -C "${bareRepoPath}" show main:api.restorm`, { encoding: 'utf-8', env: gitEnv() })
    expect(rawYaml).toContain('_projectUuid:')
    expect(rawYaml).toContain('folderType: environment')
    expect(rawYaml).toContain('Find pet by ID')
  })

  it('is idempotent — a second call is a no-op on an already-seeded repo', () => {
    seedGitServer(reposDir)
    const firstLog = execSync(`git -C "${bareRepoPath}" log --oneline`, { encoding: 'utf-8', env: gitEnv() })
    seedGitServer(reposDir)
    const secondLog = execSync(`git -C "${bareRepoPath}" log --oneline`, { encoding: 'utf-8', env: gitEnv() })
    expect(secondLog).toBe(firstLog)
  })

  it('resetGitServerSeed wipes the repo so the next call re-seeds from scratch', () => {
    seedGitServer(reposDir)
    resetGitServerSeed(reposDir)
    expect(isGitServerSeeded(reposDir)).toBe(false)
  })

  it('exposes a clone URL matching the seeded repo name', () => {
    // Unconfigured (no testcontainers override) → the legacy compose port.
    expect(gitServerUrl()).toBe(`git://localhost:9418/${SEED_REPO_NAME}`)
  })
})

describe('resolveReposDir — must target the directory the container SERVES, not this checkout', () => {
  // The compose bind is relative and the container name is global, so exactly
  // one checkout's directory is served host-wide. Resolving from `__dirname`
  // makes every run launched from a linked worktree seed a directory nothing
  // serves — clones then fail with "no such repository" while the seeder's
  // existsSync idempotence check reports success. These guard that.
  const savedOverride = process.env.RESTORM_GITSERVER_REPOS_DIR
  afterEach(() => {
    if (savedOverride === undefined) delete process.env.RESTORM_GITSERVER_REPOS_DIR
    else process.env.RESTORM_GITSERVER_REPOS_DIR = savedOverride
  })

  it('honours an explicit RESTORM_GITSERVER_REPOS_DIR override', () => {
    process.env.RESTORM_GITSERVER_REPOS_DIR = '/tmp/some-explicitly-served-dir'
    expect(resolveReposDir()).toBe('/tmp/some-explicitly-served-dir')
  })

  it('ignores an empty override rather than seeding into the filesystem root', () => {
    process.env.RESTORM_GITSERVER_REPOS_DIR = ''
    expect(resolveReposDir()).not.toBe('')
  })

  it('resolves to the running container bind-mount source, or this checkout when docker has none', () => {
    delete process.env.RESTORM_GITSERVER_REPOS_DIR

    // Derived independently of the implementation: read the whole Mounts
    // array as JSON and pick the entry ourselves, rather than reusing the
    // implementation's own --format template (which would be tautological).
    let servedSource: string | undefined
    try {
      const rawMounts = execSync("docker inspect restorm-git-server --format '{{json .Mounts}}'", {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      const mounts = JSON.parse(rawMounts) as { Source: string; Destination: string }[]
      servedSource = mounts.find((m) => m.Destination === '/srv/git')?.Source
    } catch {
      servedSource = undefined
    }

    if (servedSource === undefined) {
      // Docker down / container absent: fall back to this checkout's own
      // directory, which is what a `compose up` from here would bind.
      expect(resolveReposDir()).toBe(join(__dirname, '../docker/git-server/repos'))
    } else {
      expect(resolveReposDir()).toBe(servedSource)
    }
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
