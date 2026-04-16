# Project Rules

## After any code change

1. Run linter: `npm run lint` (use `npm run lint:fix` if possible)
2. Run type checks: `npm run typecheck`
3. Fix all errors and warnings before committing
4. Re-verify: `npm run lint && npm run typecheck`

## Code quality restrictions (absolute)

- **NEVER** use `eslint-disable`, `eslint-disable-next-line`, or `eslint-disable-line` — fix the actual issue
- **NEVER** use `test.skip()`, `it.skip()`, `describe.skip()`, or `xtest()` — fix flaky tests
- **NEVER** use `test.todo()` without implementing the test
- **NEVER** use `git push --no-verify` or `git commit --no-verify`

## Commits

Pre-commit hooks run the full test suite, which takes a long time. **NEVER** interrupt or cancel a commit in progress — wait for it to finish, even if it seems slow.

## Documentation

Do not create documentation files (`/docs/`, README, etc.) unless explicitly requested.

## Responses

- Be brief and direct, code first
- Don't explain what you're about to do, just do it
- Don't confirm success when the output already shows it
- Use bullet points over paragraphs

## Checks command

Full validation sequence:
```bash
npm run lint:fix
npm run lint
npm run typecheck
npm run test
```

## E2E tests (restorm/demo)

When writing E2E tests in `restorm/` or `demo/`:
- Use Playwright-BDD step libraries from `electron-core-ui/testing/playwright-bdd` (`defineMenuBarBddSteps`, `defineSystemModalsBddSteps`, `defineListViewBddSteps`, etc.)
- Use selectors/helpers from `electron-core-ui/testing` (`menuBarRootSelector`, `menuBarItemSelector`, etc.)
- Avoid text-based selectors (`text=File`, `text=Open`) — use `data-testid` driven steps
- If a generic reusable helper is missing, add it to `electron-core-ui/testing`, not ad-hoc in app tests

### Debugging e2e failures

When an e2e test fails, before guessing at a fix: open the end-of-test screenshot Playwright attached under `restorm/test-results/<test-dir>/attachments/end-state-screenshot-*.png` (or the step-scoped screenshot the step itself produced) with the `Read` tool. The UI state at the point of failure frequently tells you whether the production code actually broke or whether the selector / expectation is wrong. Also check `electron-logs.txt` in the same directory for main-process + renderer console messages + uncaught page errors.
