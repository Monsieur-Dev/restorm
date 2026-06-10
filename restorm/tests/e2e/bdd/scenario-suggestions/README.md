# Scenario inspector-suggestions regression test

Guards the scenario inspector's **pre-run data suggestions** (the "example data"
shown for each action before any run) against regression, by launching the real
app, extracting every action's suggestion, and comparing it to a committed
golden.

Going through the running app — not a pure unit test on `staticScenarioPreview`
— is what lets it cover **REST requests**, whose suggestions are drawn from the
call-history zip and are unavailable to a pure function.

## Layout

- `features/scenario-suggestions.feature` — a Scenario Outline; the `Examples`
  table lists which scenarios are checked.
- `steps/scenario-suggestions.steps.ts` — opens the sample, calls the extractor,
  normalizes live time fields, compares to the golden.
- `../fixtures/scenario-suggestions.fixture.ts` — launches Electron.
- Sample + goldens live in `tests/e2e/samples/`:
  - `scenarios-e2e-reference-tests.restorm` (+ `.responses-history.zip` call
    history; the runtime `.responses.zip` is gitignored — rewritten per run)
  - `scenarios-e2e-reference-tests.<scenario-slug>-suggestions.json` (one golden
    per scenario, committed + human-readable).
- The extractor itself: `src/renderer/src/testing/scenarioSuggestionsBridge.ts`
  exposes `window.__restormSuggestions.extract(scenarioName)`, mounted in
  `App.tsx`. Per action it returns `{ id, kind, suggestion, source }`, computed
  exactly as the inspector does — the config-derived static preview wins, else a
  non-static kind (e.g. `httpRequest`) falls back to its last archived run
  result via `window.restorm.runtime.getScenarioNodeResult` (`source: history`).

## Add a scenario

The reference `.restorm` already contains many scenarios; the test only checks
the ones listed. To add one (it must be a finished scenario in the sample):

1. Add a row to the `Examples` table in
   `features/scenario-suggestions.feature`, using the scenario's exact name:

   ```gherkin
   Examples:
     | scenario    |
     | Logs        |
     | Arithmetics |
     | Loops       |
     | <NewName>   |
   ```

2. Run the test once. The first run writes the missing golden (and passes):

   ```bash
   npm run build                                       # only if app code changed
   npm run test:e2e -- --project=scenario-suggestions
   ```

   This creates `tests/e2e/samples/scenarios-e2e-reference-tests.<slug>-suggestions.json`.

3. **Read the generated golden** to sanity-check the suggestions, then run the
   command again to confirm it re-compares green (proves determinism), and
   commit the golden.

## Regenerate a golden (after an intentional change)

When you deliberately change what a suggestion should be, regenerate the golden
instead of editing it by hand:

```bash
UPDATE_SUGGESTIONS_GOLDEN=1 npm run test:e2e -- --project=scenario-suggestions
```

Review the diff before committing — that diff IS the change you're claiming.

## Determinism

`log` (and `now`) actions stamp the current time, which would make the golden
flaky. The step normalizes those (`timestamp` / `now` keys → `<dynamic-time>`)
before comparing; dates embedded in config (different keys) are left intact so
real value regressions still surface. A scenario that exposes other live values
is not a good fit for this snapshot test — that's the only caveat.

A `null` suggestion is valid: the kind has no config-derived preview (and no
archived run result), so the inspector shows nothing for it.

## Why the golden isn't a Playwright snapshot

`toMatchSnapshot` resolves its path relative to the generated spec under
`.features-gen/`, which is gitignored — the golden would never persist. The step
writes/reads an explicit committed file under `tests/e2e/samples/` instead.
