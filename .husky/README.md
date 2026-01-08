# Git Hooks - Code Quality Enforcement

This directory contains Git hooks that enforce strict code quality standards.

## 🛡️ Protection Mechanisms

### Pre-commit Hook
**File**: `.husky/pre-commit`

Runs before each commit and performs:

1. **🚫 Forbidden Patterns Check**
   - Blocks any use of `eslint-disable` comments
   - Blocks skipped tests (`test.skip`, `it.skip`, `describe.skip`, `xtest`, etc.)
   - Enforces the rule: **Fix the issue, don't suppress the warning**

2. **📦 Package Checks**
   For each package (electron-core-ui, gitable, demo, restorm):
   - `depcheck` - Verifies dependencies
   - `lint` - ESLint validation
   - `typecheck` - TypeScript type checking
   - `build` - Build verification
   - `test` (restorm only) - Unit and E2E tests

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
4. Commit (hooks will validate)
5. Push (hooks will validate)

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

