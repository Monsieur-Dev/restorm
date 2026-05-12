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
- **NEVER** reference a ticket ID (`OYO-X`, `JIRA-X`, `#123`, etc.) in a source comment, `describe`/`it` title, TODO marker, or committed Markdown doc. Ticket IDs belong in the commit message, in the PR description, and in `git log` — they rot in tracked files. If a comment or doc needs to explain *why* something looks this way, describe the constraint or invariant in the present tense, without referring to the ticket that introduced it. If you need to point readers at related work, link a **file path** or a **stable doc anchor**, not a ticket URL.

## Visual claims must be verified against the screenshot

When reporting that a UI change is done — "labels removed", "edge no longer crosses the box", "spacing increased", "badge moved to the right of the name", or any other visible-state assertion — **you must look at the actual screenshot before stating it**. Don't assume the change took effect because the source diff says so: HMR may not have applied yet, the path you edited may not be the one that renders this view, or the framework may carry a hidden default that contradicts your diff.

The verification loop:

1. Make the change.
2. Trigger / wait for HMR (or rebuild if main-process).
3. Take a screenshot via the restorm MCP `screenshot` tool against the running instance.
4. Read the screenshot back with the `Read` tool and explicitly confirm the asserted change is visible — name what you see in the image.
5. Only then report "done" to the user.

If step 4 contradicts step 1, **say so honestly and keep iterating** instead of declaring victory. False "it's fixed" claims waste the user's attention twice — once on the false claim, once on rediscovering the bug.

## No commit without a test pass

**Never commit a behavioural change without exercising it first.** Lint + typecheck are the floor, not the ceiling — they catch syntax and type drift, not "does this fix actually fix the bug." Before staging a commit that asserts a fix, you owe at least one of:

- **Unit test**: add or update a `*.test.ts` that fails before your change and passes after. The diff makes the regression-protection visible to reviewers.
- **E2E test**: extend / add a `tests/e2e/bdd/...` scenario for user-visible flows. Slower, but the only honest way to prove an Electron / Monaco / IPC interaction.
- **MCP-driven manual repro**: drive restorm via the MCP tools (`screenshot`, `run_request`, `evaluate`, `dom-query`, …) to reproduce the bug on the running build, apply the fix, restart restorm if it touches main-process code (HMR doesn't pick up `src/main/`), and re-run the same MCP-driven steps to confirm the new behaviour. Take a screenshot of the green state if visual.

If you can't reach a green test before commit, **say so in the chat**: explain what blocked the verification, propose an asymmetric reviewer ask (e.g. "I can repro locally but the e2e harness can't load the Monaco editor in headless mode, please sanity-check manually"). Don't paper over it by pushing and hoping CI will tell you.

This is non-negotiable for fixes that wire across processes (main ↔ renderer ↔ IPC), touch the firewall pipeline, or change persistence — those are the paths where lint+typecheck have historically lied and the bug only surfaces under live execution.

## Commits

Pre-commit hooks run the full test suite, which takes a long time (~5–6 min on a healthy host). **NEVER** interrupt or cancel a commit in progress — wait for it to finish, even if it seems slow.

**Always commit through `scripts/git-commit-timeout.sh`** rather than calling `git commit` directly. The script wraps the commit with a hard 15-minute timeout so a flaky e2e + hung Monaco editor can't pin an automated agent for an hour. Pass through any `git commit` args you'd normally use, e.g.:

```bash
scripts/git-commit-timeout.sh -m "your message"
```

If the script exits 124 (timeout), investigate before retrying — it usually points at flakiness, X-server contention, or a genuine perf regression in a Monaco-heavy panel.

## Self-review before push

Before pushing a branch or asking for a merge, **always** run an independent code review of the diff. Use the `superpowers:code-reviewer` agent (or equivalent fresh-context agent) on the full PR scope and act on its findings — bugs, design smells, coverage gaps, stale comments, missed docs — before telling the user the PR is ready. Document agent findings that you're deliberately not addressing, don't silently skip them. Self-review applies even when the user hasn't explicitly asked for it; it's the last gate before human attention.

**As the very first step of self-review, re-read the ticket against the diff.** Pull the ticket back up (Linear, GitHub issue, etc.) and walk every acceptance-criteria checkbox + every "Sub-tasks" item, asking out loud: "is this *actually* addressed in the diff, or did I skip it?" Don't trust your earlier judgment on whether something was in scope — the ticket text is authoritative, and it's easy to drift over the course of a long ticket. Common traps:

- Acceptance items that map to UI surface you haven't touched yet (badges, tooltips, context-menu entries, errors-only paths).
- Items phrased as "refactored X" that you satisfied with a parallel-implementation instead — those usually count as a gap.
- Items phrased as "verified by tests" with no matching test file in the diff.
- Tri-state behaviours where you shipped two of the three (e.g. `deprecated` + `removed` rendered identically, manual vs auto error handling collapsed).
- Persistence / migration items — easy to forget when the new fields work fine in-memory but never round-trip through disk.

For every item you're deliberately *not* shipping in this PR, say so explicitly in the PR description with a one-line justification (out-of-scope, follow-up ticket, depends on another issue, …). Silent omissions are worse than missing items — they make the PR look complete when it isn't.

As the final step of self-review, run `grep -rEn "OYO-[0-9]+" --include="*.ts" --include="*.tsx" --include="*.css" --include="*.md"` over the diff and reject any new occurrences — the no-ticket-refs rule from Code quality restrictions applies to every PR.

## Branch up-to-date check (before push and before merge)

GitHub branch protection ("require branches to be up to date") is **not available** on this repo's plan. Enforce the same invariant manually, every time.

**Before every `git push` of a feature branch**:

1. `git fetch origin` to refresh the remote refs.
2. Check whether the current branch is behind its target (defaults to `main` unless the user said otherwise):
   ```bash
   BEHIND=$(git rev-list --count HEAD..origin/main)
   ```
3. If `BEHIND` is non-zero: **rebase the feature branch** onto `origin/main` (`git rebase origin/main`), resolve conflicts, then `git push --force-with-lease`. Do NOT push a branch that is behind. Rebase only the *feature branch* — never merge `main` into the feature branch (would litter the feature branch with extra merge commits).
4. If `BEHIND` is zero, push as usual.

**Before merging a PR** (i.e. before running `gh pr merge` or asking the user for the green light):

1. Same fetch + behind-count check, except now compare against the PR's base branch (read it from `gh pr view --json baseRefName`).
2. If the branch is behind: rebase locally, force-push (`git push --force-with-lease`), wait for CI to re-run green, then proceed to merge. Never merge a PR whose head is behind the base.
3. Mention in the PR description / final message that the up-to-date check passed (one line is enough, e.g. `branch up to date with origin/main`).

**Always integrate via a real merge commit.** The repo settings deliberately allow only `allow_merge_commit: true` (rebase + squash both disabled) — the user wants the visual "this batch was a feature branch" boundary in `git log`. Use `gh pr merge <num> --merge --delete-branch` (NOT `--rebase`, NOT `--squash`, and never a manual fast-forward). The feature branch can be rebased onto main beforehand to stay linear inside the branch, but the integration into main itself must be a `--no-ff`-style merge so the branch's start + end show up as anchor commits in the log.

This applies to every push and every merge, even for tiny one-line fixes. Skipping the check is the same class of mistake as skipping `npm run lint` — don't.

## Adding a new execution protocol or import format

When a ticket asks you to add a new execution protocol (REST, GraphQL, gRPC, MQTT, WebSocket, ...) or a new import format (OpenAPI, AsyncAPI, Postman, Bruno, OData CSDL, ...), **read the playbook first** and follow it end-to-end:

- Execution protocols → [`restorm/docs/contributing/adding-a-protocol.md`](restorm/docs/contributing/adding-a-protocol.md)
- Import-only formats → [`restorm/docs/contributing/adding-an-import.md`](restorm/docs/contributing/adding-an-import.md)

The playbook is authoritative for: file layout, the three hard rules (UI reuse, Handlebars resolution, input debouncing), Docker mock conventions, the E2E scenario matrix, the response-panel UI checks, the documentation checklist, and the per-PR review checklist. Diverging from it without explicit ticket-level approval is a review-blocker.

The matching PR template at [`.github/PULL_REQUEST_TEMPLATE/protocol.md`](.github/PULL_REQUEST_TEMPLATE/protocol.md) bundles the checklist — append `?template=protocol.md` to the PR URL when opening the PR.

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

## Restorm in dev + MCP

For interactive debugging when you also want Claude Code's MCP launcher to drive the same restorm instance, run:

```bash
pnpm dev:restorm:mcp
```

This sweeps stale MCP lockfiles (`pnpm mcp:cleanup` under the hood) and then runs `pnpm dev:restorm -- --mcp`. The `--mcp` flag turns on the embedded HTTP MCP server, which writes a per-pid lockfile to `/tmp/restorm-mcp/<pid>.json` (port + bearer token). `scripts/mcp-launcher.mjs` discovers that lockfile and forwards Claude's MCP traffic to the running instance instead of spawning a fresh, hidden one — so the renderer / DevTools you're looking at is the same renderer the launcher is talking to.

The cleanup pass is shared in two paths:

- `pnpm mcp:cleanup` (or the chained `dev:restorm:mcp` startup) runs `node scripts/mcp-launcher.mjs --gc-only` — useful before a manual launch.
- The launcher itself runs the same sweep at startup when Claude Code spawns it.

GC removes any lockfile whose recorded pid is dead, or whose endpoint no longer answers an authenticated `initialize` probe within ~800 ms. A previous restorm killed with `-9` or interrupted by a reboot won't poison discovery.

## Sending screencasts over Telegram

The restorm MCP `screencast-start` / `screencast-stop` tools return a `.webm` (vp9). Telegram retranscodes raw vp9 webm server-side, which adds visible compression artefacts (banding on smooth gradients, blocking on motion). Always pipe the webm through ffmpeg into a standards-compliant mp4 before attaching:

```bash
ffmpeg -y -i /tmp/ecu-screencast-<ts>.webm \
  -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p \
  -movflags +faststart \
  /tmp/<descriptive-name>.mp4
```

Telegram leaves a standard h264/yuv420p mp4 alone (no re-encode), so the recipient sees the source-quality frames. Costs a few seconds of ffmpeg per clip; well worth it for any UI demo where the visual fidelity is the whole point of the message.
