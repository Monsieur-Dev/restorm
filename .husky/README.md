# Git Hooks - Code Quality Enforcement

This directory contains Git hooks that enforce strict code quality standards.

## 🛡️ Protection Mechanisms

The quality gates are split by speed: **commit = fast checks**, **push = the
heavy e2e suite**. This keeps commits quick and parallelizable while making the
e2e gate impossible to forget (a plain `git push` runs it automatically).

### Pre-commit Hook
**File**: `.husky/pre-commit`

Runs before each commit and performs only the **fast** checks (~2-3 min, no app
instances → multiple commits can run in parallel):

1. **🚫 Forbidden Patterns Check**
   - Blocks any use of `eslint-disable` comments
   - Blocks skipped tests (`test.skip`, `it.skip`, `describe.skip`, `xtest`, etc.)
   - Enforces the rule: **Fix the issue, don't suppress the warning**

2. **📦 Package Checks**
   For each package (electron-core-ui, demo, restorm):
   - `depcheck` - Verifies dependencies
   - `lint` - ESLint validation
   - `typecheck` - TypeScript type checking
   - `build` - Build verification
   - `test:all` (restorm only) - Unit and integration tests

   The **Playwright e2e suite does NOT run here** — it is the heavy gate and
   moved to push time (see the Pre-push Hook below).

### Pre-push Hook
**File**: `.husky/pre-push`

Runs before pushing to remote and performs:

1. **🔒 Repository-wide Security Check**
   - Scans all tracked files for `eslint-disable` usage
   - Blocks push if any violations found

2. **📝 Commit History Validation**
   - Checks new commits being pushed
   - Detects if commits were made with `--no-verify`
   - Ensures all commits passed pre-commit checks

3. **🔍 Full lint** on every project

4. **🧪 Full Playwright e2e suite** (the heavy quality gate)
   - Runs `pnpm --filter restorm test:e2e`, which wraps Playwright in
     `xvfb-run` on Linux (isolated virtual display → the proven flake-free
     recipe)
   - The hook exports `RESTORM_SHIP=1` before invoking the suite, which
     tells `playwright.config.ts` to run with **retries:2**. A single
     memory-bound flake (different test each run) self-heals without
     aborting the push. A consistently broken test still fails all retries
     and blocks the push — retries do not mask real regressions.
   - Plain `pnpm test:e2e` (no `RESTORM_SHIP`) keeps **retries:0** for dev
     debugging, so raw failure output is immediately visible.
   - **Aborts the push on any e2e failure** — so the suite can't be forgotten
   - Only `git push --no-verify` skips it, and that is **forbidden** by project
     rules

### Shipping a branch — `scripts/ship.sh`

`scripts/ship.sh` is the orchestrator for landing a branch end-to-end:

```
rebase onto origin/main → push (the pre-push hook runs the e2e under xvfb)
  → wait for CI green → merge the PR (merge commit) + delete the branch
```

- It relies on the pre-push hook for the e2e — it never re-runs it.
- It is **gated 1-ship-at-a-time** (an flock; the host is RAM-bound) and wraps
  the push step in the same 20-min timeout + shared flake-journal mechanics as
  `scripts/git-commit-timeout.sh` (entries stamped `SHIP`).
- It aborts cleanly if the e2e fails (no push) or CI is red (no merge), and is
  **re-runnable** from any step.
- Run it only after the change has been reviewed/manually tested (`gh pr` review
  + the local VS Code campaign) — that "go" is the merge approval.

```bash
scripts/ship.sh                 # rebase → push → wait CI → merge (base: main)
scripts/ship.sh --base <epic>   # ship onto a different base
scripts/ship.sh --no-merge      # stop after CI-green, hand the merge to a human
```

## 🔧 ESLint Configuration

All projects have strict ESLint rules via `eslint-plugin-eslint-comments`:

```javascript
'eslint-comments/no-restricted-disable': ['error', '*'],  // Block all eslint-disable
'eslint-comments/no-unused-disable': 'error',              // Detect unused disables
'eslint-comments/no-unlimited-disable': 'error',           // Block unlimited disables
'eslint-comments/no-use': ['error', { allow: [] }],        // Block all comment directives
```

## ⛔ Forbidden Practices

These are **STRICTLY FORBIDDEN** and will block commits/pushes:

1. ❌ `eslint-disable`, `eslint-disable-next-line`, `eslint-disable-line`
2. ❌ `test.skip()`, `it.skip()`, `describe.skip()`, `xtest()`, `xit()`, `xdescribe()`
3. ❌ `git commit --no-verify`
4. ❌ `git push --no-verify`

## ✅ Expected Workflow

1. Write code
2. Fix all linting errors (don't suppress them)
3. Ensure all tests pass (don't skip them)
4. Commit (the pre-commit hook validates the fast checks — quick)
5. Ship with `scripts/ship.sh` (rebase → push → the pre-push hook runs the full
   e2e under xvfb → wait CI → merge). A plain `git push` also runs the e2e gate.

## 🚨 If You Encounter Issues

### Linting Error
- ❌ Don't use `eslint-disable`
- ✅ Fix the underlying code issue
- ✅ If the rule is wrong, discuss with the team

### Failing Test
- ❌ Don't use `test.skip()`
- ✅ Fix the test or the code
- ✅ If it's flaky, fix the root cause

### Hook Failure
- ❌ Don't use `--no-verify`
- ✅ Fix the issues reported by the hooks
- ✅ All hooks must pass before committing/pushing

## 🔍 Manual Hook Testing

Test pre-commit:
```bash
.husky/pre-commit
```

Test pre-push:
```bash
.husky/pre-push
```

## 📚 Related Files

- `.husky/pre-commit` - Pre-commit hook script
- `.husky/pre-push` - Pre-push hook script
- `*/eslint.config.js` - ESLint configuration per project
- `.cursor/rules/no-auto-documentation.mdc` - Project rules
- `.cursor/rules/lint-and-typecheck.mdc` - Quality rules

---

**Remember**: These hooks exist to maintain code quality. Bypassing them compromises the entire codebase.

