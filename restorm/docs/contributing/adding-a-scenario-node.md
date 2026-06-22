# Playbook — Adding a New Scenario Node (Action) to Restorm

> **Status:** authoritative reference for scenario-engine node work.
> A scenario "action" is a box on the scenario graph (a `ScenarioNodeKind`).
> The kind's **metadata** is now ONE entry in a single registry
> (`src/shared/scenarioKindRegistry.ts`); everything that used to be a separate
> hand-synced list — the kind union, the MCP enum, the add-node catalogue, the
> port map, the capability sets, the docs, the preview-wrapper set and the
> request-binding set — is **derived** from it. A missing or incomplete
> registration is caught **at CI** by the drift-guard tests (see "The safety
> net" below), not as a silent runtime no-op.

This is for a **node on the scenario surface**. For a new execution protocol
(REST/GraphQL/…) see [`adding-a-protocol.md`](./adding-a-protocol.md); for a
new import format see [`adding-an-import.md`](./adding-an-import.md).

---

## TL;DR — checklist

A new kind `foo` is done when all of these are true:

- [ ] **1. Registry entry** — add `foo: { … }` to `SCENARIO_KIND_REGISTRY`
      (`src/shared/scenarioKindRegistry.ts`): catalogue meta (`labelKey` /
      `defaultLabel` / `icon` / `category`), capability flags (only the ones
      that DIFFER from the defaults), `ports` (its own inputs/outputs + their
      `flow` class), and `doc` (purpose + config keys). This single entry makes
      `foo` appear in the kind union, the MCP `z.enum`, the add-node catalogue,
      the port map, the capability accessors, `SCENARIO_KIND_DOCS`,
      `PREVIEW_WRAPPER_KINDS` and `REQUEST_BINDING_KINDS` — all derived. (See
      step 1 for the field-by-field shape.)
- [ ] **2. Executor** — a `NodeExecutor` implemented under
      `src/main/scenarioEngine/executors/`.
- [ ] **3. Registry case (executor)** — a `case 'foo'` in `pickExecutor`
      (`src/main/scenarioEngine/executors/registry.ts`). The switch STAYS
      hand-written (it imports main-only code); the `default → assertNever` guard
      makes a missing case a build error, and `executors/registry.test.ts` makes
      it a CI failure too.
- [ ] **4. Scheduler** — only if the executor returns a new `scopeAction` (see step 4).
- [ ] **5. Node box** — a component under
      `src/renderer/src/components/Scenario/nodes/` + a line in that folder's
      `index.ts` (`Record<ScenarioNodeKind, …>` — type-enforced).
- [ ] **5a. Restrict the value-field types** — every `TypedValueField` in the
      box must pass `excludeTypes` so its type-pick menu only offers types that
      make sense for that operand (see step 5a).
- [ ] **5b. Roomy editing where it helps** — a multiline operand uses
      `ScenarioCodeField` / `ScenarioCodeEditButton` (see step 5b).
- [ ] **5c. Inspector output preview** — set `staticPreview: true` in the
      registry entry (step 1) so a selected box shows its output value in the
      inspector panel; verify it live (step 5c).
- [ ] **6. Static-preview LOGIC** — only the `staticPreview` FLAG lives in the
      registry; the preview-SHAPE logic is still a `switch` you extend in
      `src/shared/utils/scenarioStaticPreview.ts` (+ an `applyListOp` branch /
      `ScenarioEditorView.tsx` wiring for list nodes — see step 6).
- [ ] **7. Help text** — a user-facing `scenario.help.foo` in **every** locale
      (see step 8): the inspector's "what this action does" line.
      `scenarioNodeHelp.test.ts` fails until every kind has one.
- [ ] **7a. Role-aware help** — if the action behaves differently as a SERVER vs
      a client, add a `scenario.help.fooServer` per-role variant (see step 8 →
      "Role-aware help text").
- [ ] **8. i18n** — port/field labels **and** the `scenario.help.foo` help text
      added to **every** locale under
      `src/renderer/locales/*/translation.json` (see step 8).
- [ ] **9. Tests** — a `*.test.ts` exercising the executor + (if it fans out) an
      end-to-end scheduler run.
- [ ] **10. Lint + typecheck + tests** green:
      `npm run lint && npm run typecheck && npx vitest run src/shared/scenarioKindRegistry.test.ts src/main/scenarioEngine`.
- [ ] **11. Bestiary** — drop one box of the new kind into the **Bestiary**
      scenario so the catalogue stays visually complete (see step 11).

---

## The safety net — guard tests catch drift at CI

The registry is the single source of truth, and two drift-guard tests fail in CI
the moment a layer falls out of lockstep — so a missed registration is a red
build, not a silent no-op:

- **`src/shared/scenarioKindRegistry.test.ts`** — for every registry kind it
  asserts ports / doc / catalogue meta / capabilities are present and that the
  derived lists (the catalogue in key order, `SCENARIO_KINDS`,
  `STATIC_PREVIEW_KINDS`, `SCENARIO_KIND_DOCS`, …) equal the registry keys, with
  no orphans and no kind falling through to the generic FALLBACK ports.
- **`src/main/scenarioEngine/executors/registry.test.ts`** — asserts
  `pickExecutor` resolves an executor for every registry kind (plus the legacy
  `request` alias). This is what catches the one thing the registry can't derive:
  a kind authored without an executor.

So: add the registry entry (step 1) and the executor case (step 3), and if you
forget either, CI tells you. The compile-time `default → assertNever` in the
executor switch is the build-time half of the same guard.

---

## The three shapes of a node

Pick the closest existing node and copy its shape — it decides steps 2, 4, 5, 6.

| Shape | Examples | Executor returns | Scope action? | Box |
| --- | --- | --- | --- | --- |
| **Pure value** | `arithmetic`, `comparator`, `object`, `transform`, `now` | `{ outputs: [{ port, value }] }` | no | operands → result |
| **Control / branch** | `if`, `switch`, `assert`, `while`, `doWhile` | routes the trigger to one of several signal outputs | no | operands + operator → then/else |
| **Scope / loop** | `forEach`, `for` | `{ outputs: [], scopeAction: { type: 'openForEach', … } }` | **yes** | items/range + parallelism → each/done |

---

## Step 1 — Registry entry (the single source of truth)

`src/shared/scenarioKindRegistry.ts`, the `SCENARIO_KIND_REGISTRY` object. Add a
key for your kind, in the position that matches its catalogue group (**key order
IS the add-node palette order** — place it next to its category neighbours). The
object is authored with `satisfies Record<string, KindSpec>`, so the keys stay
the literal-union source: `type ScenarioNodeKind = keyof typeof
SCENARIO_KIND_REGISTRY`. Adding a key widens the union and, through the
derivations, every dependent list.

A `KindSpec` entry has four parts:

### Catalogue meta (drives the palette + the node box header)

- `labelKey` — i18n key (`scenario.nodes.<kind>`), falling back to `defaultLabel`.
- `defaultLabel` — what actually renders today (there is no populated
  `scenario.nodes.*` section; labels fall back to `defaultLabel`).
- `icon` — a codicon glyph.
- `category` — groups the add-node menu; consecutive same-category entries get a
  divider. A category can render as a **submenu** instead — the `loops` category
  (forEach / for / while / doWhile) is folded into one "Loops" submenu in
  `ScenarioEditorView.tsx` (`SCENARIO_SUBMENU_CATEGORIES['loops']` + the palette `flatMap`); copy that
  pattern for any future grouped family. Submenu categories are declared in
  `SCENARIO_SUBMENU_CATEGORIES` in `scenarioNodeCatalogue.ts`.

### Capability flags (state ONLY the exceptions)

Each flag has a documented default in the `KindSpec` type; omit it to take the
default, set it only to differ:

- `acceptsInputEvent` (default `true`) — whether the kind carries the header `in`
  launch trigger. Almost every kind keeps it (including the `output` sink, so it
  can be sequenced). Data-driven nodes (collections, pure value) keep it too — a
  wired `in` lets a flow gate WHEN they (re)compute / re-read a variable; left
  unwired, they still run once their value inputs resolve. Set `false` only for a
  genuinely untriggerable kind.
- `hasErrorPort` (default `true`) — the implicit `error` output. Opt out
  (`false`) for sinks / pure reads / the retry error-boundary (`output`, `now`,
  `retry`). `log` / `toast` KEEP it — they render Handlebars that can fail.
- `hasDonePort` (default `true`) — the implicit `done` completion output. Opt out
  for the `output` sink and `throw` (never completes normally).
- `staticPreview` (default `false`) — opt IN for any node whose output is
  computable from config + upstream static values (most pure / control nodes).
  This backs `STATIC_PREVIEW_KINDS` and the inspector preview; the preview SHAPE
  is still a switch (step 6).
- `previewWrapper` (default `false`) — set `true` only when the node's output
  token genuinely IS the wrapper object its preview models (`transform` emits
  `{ result }`, `input` emits `{ <name>: value }`, `object` the object), so a
  downstream selector must NOT unwrap it. Backs `PREVIEW_WRAPPER_KINDS`.
- `requestBinding` (default `false`) — set `true` if the node binds a sidebar
  request via `config.requestId` (`httpRequest`, the streaming connect nodes,
  `httpListen`). Backs `REQUEST_BINDING_KINDS` (the "used in scenarios"
  reverse-nav + the delete → move-into-scenario flow). A node that references a
  *connection node id* instead of a request (e.g. `httpClose`, the `…Send` /
  `…Close` siblings) leaves this unset.

### `ports` — the kind's own inputs/outputs

A `KindPorts` (`{ inputs: PortSpec[]; outputs: PortSpec[] }`). Each port declares:

- `id` — the port id the executor emits on / reads from (e.g. `then`, `each`, `result`).
- `name` — the visible label (often overridden by i18n in the box).
- `role` — `then` / `else` / `default` / `response` drives the default edge colour
  + the signal/value derivation.
- `flow` — **the connection class**, validated by `isValidScenarioConnection`:
  - `signal` — a pure trigger (a `then` / a completion). Accepts B/AB.
  - `value` — data only. Accepts A/AB.
  - `both` — carries data *and* sequences (e.g. an HTTP `response`, a
    `forEach.each`, a stream `message`).
- The header launch trigger (`in`, the shared `IN` const `{ id: 'in', flow:
  'signal' }`) is **NOT listed here** — `defaultPortsForKind` prepends it for
  every kind whose `acceptsInputEvent` is not `false`. So a `ports` entry lists
  only the kind's own data inputs.
- The implicit `error` and `done` outputs are drawn by the box automatically —
  never list them; they come from the `hasErrorPort` / `hasDonePort` flags above.

**Requiredness is edge-driven**, not declared here: the scheduler awaits a port
only when an edge points at it. So operands with an inline value fallback (the
`if`/`for` pattern) are not "required" — the box flags them red only when there
is genuinely nothing to pick.

**Port ↔ data coherence — verify it against a real run.** A port's `flow` and its
data shape must match what the executor actually reads/emits on it: a data input
must be `value`/`both` and accept the value the executor consumes; an output that
carries a received payload (a stream frame, an HTTP `response`) must be `both` and
emit exactly the parsed object a downstream JSON-path picker binds against; a
completion that carries nothing is `signal`, not a data port. A mismatch is silent
— wired nodes get empty/garbled data and the inspector preview lies — so confirm
the real value flows on the real port before trusting it (the streaming `message`
port was validated this way).

### `doc` — MCP / inspector documentation

A `ScenarioKindDoc` (`{ summary: string; config?: Record<string, string> }`).
`summary` is the one-line purpose; `config` documents each per-kind config key.
This backs `SCENARIO_KIND_DOCS`, surfaced by the `describe_scenario_kinds` MCP
tool, so an MCP client can author the node without reading source. (A newly added
MCP **tool** needs a restorm restart + fresh session to appear; a new kind on the
existing `create_scenario_node` / `describe_scenario_kinds` tools is picked up on
restart.)

## Step 2 — Executor

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

## Step 3 — Registry case (executor switch)

`src/main/scenarioEngine/executors/registry.ts` — add a `case 'foo': return
fooExecutor` to `pickExecutor`. This switch deliberately STAYS hand-written: it
imports main-only executors (sockets / fs / gRPC / QuickJS), so it can't live in
the shared registry object. Two guards keep it honest:

- the `default → assertNever(k)` branch is a **compile-time** exhaustiveness
  check — once `foo` is in the kind union (step 1), the switch no longer covers
  every kind and the build fails until you add the case;
- `executors/registry.test.ts` asserts at **CI** that `pickExecutor` resolves for
  every registry kind, catching the same drift even where the build's project
  references don't reach the main process.

(The legacy `request` alias is handled before the switch — it maps to the
httpRequest executor; it is not a catalogue kind.)

## Step 4 — Scheduler (scope/loop nodes only)

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

## Step 5 — Node box + registration

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

### Step 5a — Restrict the value-field types

Every `TypedValueField` in the box must pass `excludeTypes` so its type-pick menu
only offers types that make sense for that operand. A string-parse operand
(`json`/`xml`/`yaml`/`csv` value, regex/crypto value) keeps `string` +
`expression` (+ `environment` + `secret`, all string-resolvable) and excludes
`number`/`dateTime`/`boolean`/`color`/`list`. A `dateTime` operand keeps
`dateTime` + `string` + `expression` (+ env/secret) and excludes
`color`/`boolean`/`number`/`list`. A numeric operand keeps `number` +
`expression`. **Never leave the full type menu on an operand that can't accept
most of those types** — it ships nonsensical choices (e.g. a colour into a date).
When in doubt, look at what the executor actually does with the value.

### Step 5b — Roomy editing where it helps

A multiline operand (a document to parse: `csv`/`json`/`xml`/`yaml` value, a
schema, a long template) should use `ScenarioCodeField` (read-only preview +
full-screen `ScenarioCodeEditorModal`) or expose the `ScenarioCodeEditButton`
beside the inline editor (see `ScenarioExpressionField`). Don't cram a multiline
value into a single-line field.

### Step 5c — Inspector output preview

Set `staticPreview: true` in the registry entry (step 1) so a selected box shows
its output value in the inspector panel. Verify it live: select the box, confirm
the inspector actually renders preview data (not an empty panel). A node whose
output can't be previewed statically is the exception, not the default — most
pure nodes should preview.

## Step 6 — Static-preview LOGIC

The `staticPreview` FLAG is in the registry (step 1); the preview-SHAPE LOGIC
stays a `switch` you extend in `src/shared/utils/scenarioStaticPreview.ts`. It
powers the inspector's "expected output" without a run:

- Add a `case` to the `staticScenarioPreview` switch returning the preview shape
  (e.g. `{ condition, branch }` for `if`-likes). The switch's `default: return
  null` is correct — a `staticPreview: false` kind legitimately has no case.
- For list/iteration nodes, add an `applyListOp` branch (sizing readout:
  `{ totalItems, itemsPerBatch, batches }`) and, if it reads a wired `items`
  edge, list the kind in the `listOp` check in `ScenarioEditorView.tsx`.
  `for` is the exception — its range comes from config, so its preview calls
  `applyListOp` with an empty list.

(`PREVIEW_WRAPPER_KINDS` is derived from the registry's `previewWrapper` flag —
set the flag in step 1, don't edit a set here.)

## Step 7 — Help text

Add a user-facing `scenario.help.<kind>` to **every** locale (see step 8) — the
one-line "what this action does" the inspector shows for a selected box. It's a
hard requirement (`scenarioNodeHelp.test.ts` enforces one per kind); seed `en`
from the kind's registry `doc.summary` but make it friendlier/shorter, and
translate `fr` in vouvoiement.

### Step 7a — Role-aware help text (server vs client actions)

A single kind can describe **two roles** — e.g. a connect node bound to a client
request *opens a connection*, but bound to a SERVER request (restorm hosts it) it
*starts a server*. A "what this action does" written for one role is wrong for
the other. When a kind is role-dependent, ship a **per-role help text**, don't
settle for a one-size-fits-all blurb:

1. **Add a role-specific key** alongside the default — e.g.
   `scenario.help.<kind>Server` next to `scenario.help.<kind>` — in **every**
   locale, describing the server behaviour in its own terms ("starts a server on
   port + route", "ACKs every received event", "broadcasts to connected
   clients"). The inspector resolves `scenario.help.${helpKey ?? kind}`, so the
   editor just sets `helpKey = '<kind>Server'` on the preview node when the bound
   request is a server (see `ScenarioEditorView`'s `previewNode` memo +
   `InspectorPreviewNode.helpKey`). Never overload the `kind` itself — the
   override key keeps the default intact.

2. **Propagate the role to the satellite actions.** A connect node's *send* and
   *close* siblings reference the connection by node id, so they inherit its
   role: a send on a server connection *broadcasts to clients* (not "sends on a
   connection"), and a close *stops the server* (not "closes a connection").
   Resolve the referenced connection node → its bound request → role, and pick
   `scenario.help.<sendKind>Server` / `<closeKind>Server` the same way. Don't
   leave the dependent actions describing the client role when the connection they
   act on is a server.

## Step 8 — i18n (all locales, no exceptions)

Port/field labels go under `scenario.<kind>.*` in **every**
`src/renderer/locales/*/translation.json` — all 27, not just `en`/`fr`. A missing
key silently falls back to `en`, so the bug is invisible in dev and only a
`de`/`ja`/`cs` user sees it.

**Also add `scenario.help.<kind>`** (step 7) — and `scenario.help.<kind>Server`
if role-aware (step 7a). Translate `fr` properly (vouvoiement / match the
surrounding tone); for languages you cannot translate, still add the **key** with
an English placeholder so the JSON structure stays parallel. A small Node script
that parses each file, sets the keys, and re-serialises with `JSON.stringify(obj,
null, 2) + "\n"` keeps the diff additive (the files are all 2-space +
trailing-newline).

## Step 9 — Tests

A `*.test.ts` next to the engine source. Unit-test the executor as a pure
function (build a synthetic `activation` + `ctx`), and — for anything that fans
out or loops — drive a real `Scheduler` over a synthetic `ScenarioModel` with the
real executor wired in, asserting the emitted values + terminal state.
`scheduler.test.ts` / `loops.test.ts` show the `buildScenario` helper pattern.
(The two drift-guard tests from "The safety net" already cover registry
completeness + the executor mapping — you don't write those per kind.)

## Step 10 — Gate

```bash
npm run lint && npm run typecheck && npx vitest run src/shared/scenarioKindRegistry.test.ts src/main/scenarioEngine
```

Then verify on the running app: a renderer/box change rides HMR; a `main`
(executor / scheduler / ports-in-main) or preload/MCP change needs a full restorm
restart. Confirm the new box drops from the add-node menu, wires, and runs —
don't trust the diff alone.

## Step 11 — Bestiary

The **Bestiary** is a reference scenario that holds exactly one box of every kind
— no wiring, no execution, no run-log golden. It is the at-a-glance visual
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
one is via the MCP `create_scenario_node` tool against the Bestiary's scenario id,
or by dragging the box in from the add-node menu and saving.
