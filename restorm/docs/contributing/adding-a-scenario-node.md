# Playbook — Adding a New Scenario Node (Action) to Restorm

> **Status:** authoritative reference for scenario-engine node work.
> A scenario "action" is a box on the scenario graph (a `ScenarioNodeKind`).
> Adding one touches a fixed set of files across `shared` / `main` / `renderer`.
> Do this checklist end-to-end — a missed registration site shows up as a
> silent no-op (an unknown kind renders an inert box, or the engine throws
> `no executor for kind '…'` at run time), not a compile error, *except* for
> the two `Record<ScenarioNodeKind, …>` maps which the type system does
> enforce (see steps 1 and 6).

This is for a **node on the scenario surface**. For a new execution protocol
(REST/GraphQL/…) see [`adding-a-protocol.md`](./adding-a-protocol.md); for a
new import format see [`adding-an-import.md`](./adding-an-import.md).

---

## TL;DR — checklist

A new kind `foo` is done when all of these are true:

- [ ] **1. Kind union** — `foo` added to `ScenarioNodeKind` (`src/shared/types/scenario.ts`).
- [ ] **2. Ports** — `foo` entry in `PORTS` (`src/shared/scenarioNodePorts.ts`): its own inputs/outputs + their `flow` class (the header `in` trigger is added automatically — see step 2). Declare any non-default capability in `src/shared/scenarioNodeCapabilities.ts` (e.g. opt out of the input event, or opt into static preview).
- [ ] **3. Executor** — a `NodeExecutor` implemented under `src/main/scenarioEngine/executors/`.
- [ ] **4. Registry** — `pickExecutor` case in `src/main/scenarioEngine/executors/registry.ts`.
- [ ] **5. Scheduler** — only if the executor returns a new `scopeAction` (see step 5).
- [ ] **6. Node box** — a component under `src/renderer/src/components/Scenario/nodes/` + a line in that folder's `index.ts` (`Record<ScenarioNodeKind, …>` — type-enforced).
- [ ] **6a. Restrict the value-field types** — every `TypedValueField` in the box must pass `excludeTypes` so its type-pick menu only offers types that make sense for that operand. A string-parse operand (`json`/`xml`/`yaml`/`csv` value, regex/crypto value) keeps `string` + `expression` (+ `environment` + `secret`, all string-resolvable) and excludes `number`/`dateTime`/`boolean`/`color`/`list`. A `dateTime` operand keeps `dateTime` + `string` + `expression` (+ env/secret) and excludes `color`/`boolean`/`number`/`list`. A numeric operand keeps `number` + `expression`. **Never leave the full type menu on an operand that can't accept most of those types** — it ships nonsensical choices (e.g. a colour into a date). When in doubt, look at what the executor actually does with the value.
- [ ] **6b. Roomy editing where it helps** — a multiline operand (a document to parse: `csv`/`json`/`xml`/`yaml` value, a schema, a long template) should use `ScenarioCodeField` (read-only preview + full-screen `ScenarioCodeEditorModal`) or expose the `ScenarioCodeEditButton` beside the inline editor (see `ScenarioExpressionField`). Don't cram a multiline value into a single-line field.
- [ ] **6c. Inspector output preview** — opt the kind into `STATIC_PREVIEW` (step 8) so a selected box shows its output value in the inspector panel. Verify it live: select the box, confirm the inspector actually renders preview data (not an empty panel). A node whose output can't be previewed statically is the exception, not the default — most pure nodes should preview.
- [ ] **7. Catalogue** — entry in `scenarioNodeCatalogue.ts` (label, icon, category).
- [ ] **8. Static preview** — opt into `STATIC_PREVIEW` in `src/shared/scenarioNodeCapabilities.ts` and/or `applyListOp` + the preview `switch` in `src/shared/utils/scenarioStaticPreview.ts`, plus the inspector wiring in `ScenarioEditorView.tsx` if it consumes an `items` list.
- [ ] **9. MCP** — `foo` added to `SCENARIO_KINDS` in `src/main/mcp/tools/scenario.ts`, AND a `SCENARIO_KIND_DOCS` entry in `src/shared/scenarioKindDocs.ts` (purpose + config keys — `Record<ScenarioNodeKind>`, type-enforced) so `describe_scenario_kinds` exposes it to MCP clients.
- [ ] **10. i18n** — port/field labels added to **every** locale under `src/renderer/locales/*/translation.json` (see step 10).
- [ ] **11. Tests** — a `*.test.ts` exercising the executor + (if it fans out) an end-to-end scheduler run.
- [ ] **12. Lint + typecheck + tests** green: `npm run lint && npm run typecheck && npx vitest run src/main/scenarioEngine`.
- [ ] **13. Bestiary** — drop one box of the new kind into the **Bestiary** scenario so the catalogue stays visually complete (see step 13).

---

## The three shapes of a node

Pick the closest existing node and copy its shape — it decides steps 3, 5, 6, 8.

| Shape | Examples | Executor returns | Scope action? | Box |
| --- | --- | --- | --- | --- |
| **Pure value** | `arithmetic`, `comparator`, `object`, `transform`, `now` | `{ outputs: [{ port, value }] }` | no | operands → result |
| **Control / branch** | `if`, `switch`, `assert`, `while`, `doWhile` | routes the trigger to one of several signal outputs | no | operands + operator → then/else |
| **Scope / loop** | `forEach`, `for` | `{ outputs: [], scopeAction: { type: 'openForEach', … } }` | **yes** | items/range + parallelism → each/done |

---

## Step 1 — Kind union

`src/shared/types/scenario.ts`, the `ScenarioNodeKind` union. Add the string
under the matching `//` section comment. This is the single source of truth;
the two `Record<ScenarioNodeKind, …>` maps (step 6, and the implicit MCP enum)
fail to compile until every kind is covered.

## Step 2 — Ports

`src/shared/scenarioNodePorts.ts`, the `PORTS` map. Each input/output declares:

- `id` — the port id the executor emits on / reads from (e.g. `then`, `each`, `result`).
- `name` — the visible label (often overridden by i18n in the box).
- `role` — `then` / `else` / `default` / `response` drives the default edge colour + the signal/value derivation.
- `flow` — **the connection class**, validated by `isValidScenarioConnection`:
  - `signal` — a pure trigger (the header `in`, a `then`/`done`). Accepts B/AB.
  - `value` — data only. Accepts A/AB.
  - `both` — carries data *and* sequences (e.g. an HTTP `response`, a `forEach.each`).
- The header launch trigger (`in`, the shared `IN` const `{ id: 'in', flow: 'signal' }`) is **NOT listed here** — `defaultPortsForKind` prepends it for every kind that `acceptsInputEvent` (`src/shared/scenarioNodeCapabilities.ts`), which is the default. So a `PORTS` entry lists only the kind's own data inputs. The trigger is the capability's business: a kind opts OUT only by joining `NO_INPUT_EVENT` there (empty today — every kind carries the trigger, including the `output` sink so it can be sequenced). Data-driven nodes (collections, pure value) DO carry it — a wired `in` lets a flow gate WHEN they (re)compute / re-read a variable; left unwired, they still run once their value inputs resolve.
- The implicit `error` and `done` outputs are drawn by the box automatically —
  never list them. Both are capability-driven (`hasErrorPort` / `hasDonePort` in
  `scenarioNodeCapabilities.ts`, true by default); opt a kind out there (e.g. the
  `output` sink has neither, `log` / `now` have no `error`).

**Requiredness is edge-driven**, not declared here: the scheduler awaits a port
only when an edge points at it. So operands with an inline value fallback (the
`if`/`for` pattern) are not "required" — the box flags them red only when there
is genuinely nothing to pick.

## Step 3 — Executor

A `NodeExecutor` (`src/main/scenarioEngine/types.ts`):
`(activation, ctx) => ExecResult | Promise<ExecResult>`. It reads
`activation.inputs[portId]` and `ctx.node.config`, and returns `outputs`
(emissions) and/or a `scopeAction`. Bundle pure executors in
`pureExecutors.ts`, time/iteration ones in `timeAndFlowExecutors.ts`.

- Resolve config values through `concreteValue` — a persisted value is a typed
  `{ type, value }`, never a bare primitive.
- For async work, honour `ctx.signal`: reject on abort so a Stop cleans up
  (see `waitExecutor`).
- **Reuse, don't fork.** `while` / `doWhile` ARE `ifExecutor` — the registry
  maps them to it. A new node that is "X but relabelled" should reuse X's
  executor, not copy it.

## Step 4 — Registry

`src/main/scenarioEngine/executors/registry.ts` — add a `case` to
`pickExecutor`. The `default` throws, so a missing case is a run-time error.

## Step 5 — Scheduler (scope/loop nodes only)

Skip unless your executor returns a new `scopeAction`. A scope node fans out
child scopes and defers its own completion until they close — see
`runForEach` + the `handleExecResult` / `dispatch` branches in
`scheduler.ts`. **`for` needed no scheduler change**: it builds a numeric range
and reuses the existing `openForEach` action. Prefer that — only add a new
`scopeAction` variant (and its `types.ts` union member) if the lifecycle truly
differs from forEach.

Loops that close via a **wired return edge** (`while` / `doWhile`) need nothing
here either: the scheduler already keeps `withLatestFrom` MERGE semantics on a
loop-back edge (a multi-edge `in` that is *not* a forward fan-in), so the node
re-fires each pass. The global max-activations net guards a non-terminating loop.

## Step 6 — Node box + registration

A component under `src/renderer/src/components/Scenario/nodes/` rendering
`ScenarioNodeBoxBase` with `left` sections + `right` cells. Reuse the shared
pieces — `TypedValueField` + `OperatorToggle` for operands (the base swaps a
`TypedValueField` for the JSON-path selector once a data link is wired),
`buildListItemsCell` for an `items` input, `buildParallelismCell` for the
parallelism row. Then add **one line** to `nodes/index.ts`'
`SCENARIO_NODE_COMPONENTS` (`Record<ScenarioNodeKind, …>` — TypeScript rejects a
missing kind here).

The header launch-trigger handle is drawn by `ScenarioNodeBoxBase` itself,
straight off the node's ports (it shows iff the node carries the `in` port) —
there is no prop to pass. `nodes/scenarioNodePortCells.test.tsx` renders every
kind and asserts each spec port has a matching cell and the trigger matches the
capability, so a drifted/missing cell id fails the build.

## Step 7 — Catalogue (palette + add-node menu)

`scenarioNodeCatalogue.ts` — `{ kind, labelKey, defaultLabel, icon, category }`.
`defaultLabel` is what actually renders (there is no `scenario.nodes.*` i18n
section — labels fall back to `defaultLabel`). `icon` is a codicon glyph.
`category` groups the add-node menu; consecutive same-category entries are
separated by a divider. A category can be rendered as a **submenu** instead —
the `loops` category (forEach / for / while / doWhile) is folded into one
"Loops" submenu in `ScenarioEditorView.tsx` (`LOOP_METAS` + the palette
`flatMap`); copy that pattern for any future grouped family.

## Step 8 — Static preview

`src/shared/utils/scenarioStaticPreview.ts` powers the inspector's
"expected output" without a run:

- Add the kind to the `STATIC_PREVIEW` set in `src/shared/scenarioNodeCapabilities.ts`
  (it backs `STATIC_PREVIEW_KINDS`) if its output is computable from config +
  upstream static values (every control/value node; `if`-likes).
- Add a `case` to the `staticScenarioPreview` switch returning the preview
  shape (e.g. `{ condition, branch }` for `if`-likes).
- For list/iteration nodes, add an `applyListOp` branch (sizing readout:
  `{ totalItems, itemsPerBatch, batches }`) and, if it reads a wired `items`
  edge, list the kind in the `listOp` check in `ScenarioEditorView.tsx`.
  `for` is the exception — its range comes from config, so its preview calls
  `applyListOp` with an empty list.

## Step 9 — MCP

`src/main/mcp/tools/scenario.ts` — add the kind to the `SCENARIO_KINDS` array
so `create_scenario_node` accepts it. (A newly added MCP **tool** needs a
restorm restart + fresh session to appear; a new kind on an existing tool is
picked up on restart.)

## Step 10 — i18n (all locales, no exceptions)

Port/field labels go under `scenario.<kind>.*` in **every**
`src/renderer/locales/*/translation.json` — all 27, not just `en`/`fr`. A
missing key silently falls back to `en`, so the bug is invisible in dev and
only a `de`/`ja`/`cs` user sees it. Translate `fr` properly (vouvoiement /
match the surrounding tone); for languages you cannot translate, still add the
**key** with an English placeholder so the JSON structure stays parallel. A
small Node script that parses each file, sets the keys, and re-serialises with
`JSON.stringify(obj, null, 2) + "\n"` keeps the diff additive (the files are
all 2-space + trailing-newline).

## Step 11 — Tests

A `*.test.ts` next to the engine source. Unit-test the executor as a pure
function (build a synthetic `activation` + `ctx`), and — for anything that fans
out or loops — drive a real `Scheduler` over a synthetic `ScenarioModel` with
the real executor wired in, asserting the emitted values + terminal state.
`scheduler.test.ts` / `loops.test.ts` show the `buildScenario` helper pattern.

## Step 12 — Gate

```bash
npm run lint && npm run typecheck && npx vitest run src/main/scenarioEngine
```

Then verify on the running app: a renderer/box change rides HMR; a `main`
(executor / scheduler / ports-in-main) or preload/MCP change needs a full
restorm restart. Confirm the new box drops from the add-node menu, wires, and
runs — don't trust the diff alone.

## Step 13 — Bestiary

The **Bestiary** is a reference scenario that holds exactly one box of every
kind — no wiring, no execution, no run-log golden. It is the at-a-glance visual
catalogue of "what does each action look like", and it lives next to `Main` in
the e2e reference sample:

```
restorm/tests/e2e/samples/scenarios-e2e-reference-tests.restorm
  → Auth Service / Pet API / Bestiary
```

When you add a new kind, drop one default box of it into the Bestiary, placed on
the grid so it does **not** overlap its neighbours (the existing boxes sit on a
~480 × 460 px grid). Leave it unwired — the Bestiary is never run and is
deliberately excluded from the run-log feature + goldens. The easiest way to add
one is via the MCP `create_scenario_node` tool against the Bestiary's scenario
id, or by dragging the box in from the add-node menu and saving.
