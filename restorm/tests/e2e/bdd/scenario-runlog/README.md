# Scenario run-log regression test

Guards the **whole run-log pipeline** — engine events → renderer run-log →
inspector "copy" — against regression. It launches the real app, opens a
finished scenario, runs it through the actual execution engine, then drives the
inspector exactly as a user would:

1. clicks the inspector **Run** button (no node selected → the whole scenario),
2. waits for the engine to finish,
3. flips the **"Show all logs"** toggle (so every engine + run + user entry is
   visible, not just the user `log` actions),
4. clicks the **copy** button,
5. reads the YAML back from the clipboard and compares it to a committed golden.

Going through the running app — not a unit test on the engine — is what makes
this cover the real IPC bridge (`scenario:engine:*`), the renderer's run-log
accumulation, and the YAML copy format all at once.

## Layout

- `features/scenario-runlog.feature` — a Scenario Outline; the `Examples` table
  lists which scenarios are run.
- `steps/scenario-runlog.steps.ts` — opens the sample, navigates the tree, runs
  the scenario, toggles + copies, normalizes run-time, compares to the golden.
- `../fixtures/scenario-runlog.fixture.ts` — launches Electron.
- Sample + goldens live in `tests/e2e/samples/`:
  - `scenarios-e2e-reference-tests.restorm` (+ `.responses-history.zip` call
    history) — shared with the inspector-suggestions test. The committed call
    history is the stable `-history` copy; the runtime `.responses.zip` the dev
    app / tests rewrite per run is gitignored, so the samples tree never churns.
  - `scenarios-e2e-reference-tests.<scenario-slug>-runlog.yaml` (one golden per
    scenario, committed + human-readable YAML — the same shape the copy button
    puts on the clipboard).

## How the static golden files were generated

The goldens are **never hand-written** — they are captured from the live copy:

1. Add the scenario name to the `Examples` table in the `.feature` (see below).
2. Run the test with `UPDATE_RUNLOG_GOLDEN=1` set — the `Then` step then writes
   whatever the copy button produced (after normalization) to
   `scenarios-e2e-reference-tests.<slug>-runlog.yaml`. (A **missing** golden
   without the flag is a hard failure, never a silent self-bless — that way a
   renamed / mistyped slug can't pass green.)

   ```bash
   npm run build                                                        # only if app/main code changed
   UPDATE_RUNLOG_GOLDEN=1 npm run test:e2e -- --project=scenario-runlog # writes the goldens
   ```

3. **Read the generated YAML** to sanity-check the run-log, then run the command
   **again** (no env var) so it re-compares green — proving the run is
   deterministic — and commit the golden.

So the golden is literally "the bytes the copy button copied, with the per-run
time fields placeholdered". The capture and the assertion go through the exact
same normalizer, so they can only differ on real content.

## Add a scenario

The reference `.restorm` holds many scenarios; the test only runs the ones
listed. To add one (it must be a finished scenario in the sample):

```gherkin
Examples:
  | scenario    |
  | Logs        |
  | Arithmetics |
  | Loops       |
  | <NewName>   |
```

Then follow the three generation steps above. The tree path the step expands to
reach a scenario is `Auth Service > Pet API > Main > <scenario>` — a scenario
nested elsewhere needs `SCENARIO_TREE_PATH` in the step file adjusted.

## Regenerate a golden (after an intentional change)

When you deliberately change the engine's logging or the copy format, regenerate
rather than editing by hand:

```bash
UPDATE_RUNLOG_GOLDEN=1 npm run test:e2e -- --project=scenario-runlog
```

Review the diff before committing — that diff IS the behavioural change you're
claiming.

## Determinism

Two kinds of per-run noise are normalized before comparing, both in
`normalizeRunLogYaml`:

- **The bracketed time in every message** (`<emoji> [<date>] <text>`) → replaced
  with `[<time>]`.
- **Absolute wall-clock values in entry `data`** — keys `timestamp`, `now`,
  `startedAt`, `finishedAt`, `endedAt`, `completedAt` (a `log` of the current
  instant, or the engine's error context) → replaced with `<dynamic-time>`.
  Dates that live under *other* keys (e.g. a config field like
  `BTTFArrivalDate`) are deliberately left intact so a real value regression
  still fails the test.

Everything else must be stable run-to-run. The covered scenarios are pure
log / arithmetic / loop graphs whose **log order is deterministic** (loops run
`batchSize=1`, so even `forEach` is sequential). A scenario whose engine-event
order is genuinely racy (unbounded parallel branches) is not a good fit for an
exact-match snapshot — pick deterministic scenarios.

## Why the golden isn't a Playwright snapshot

`toMatchSnapshot` resolves its path relative to the generated spec under
`.features-gen/`, which is gitignored — the golden would never persist. The step
writes/reads an explicit committed file under `tests/e2e/samples/` instead.
