# Playbook — Adding a New Value/Secret Source to Restorm

> **Status:** authoritative reference for value-source work.
> A "value source" is a backend that resolves a `SecretValue` at execution
> time — env vars, file-stored secrets, remote vaults, and so on.
> Adding one touches a fixed set of files across `shared` / `main` / `renderer`.
> Do this checklist end-to-end: a missed registration site causes the source to
> be silently absent from the "Others ▸" type menu, and a missing resolver
> causes `SecretHydrationService` to throw `unknown secret source: <id>` at run
> time.

This is for a **new value/secret source**. For a new execution protocol
(REST/GraphQL/…) see [`adding-a-protocol.md`](./adding-a-protocol.md); for a
new import format see [`adding-an-import.md`](./adding-an-import.md); for a new
scenario node see [`adding-a-scenario-node.md`](./adding-a-scenario-node.md).

---

## TL;DR — checklist

A new source `foo` is done when all of these are true:

- [ ] **1. Shared descriptor** — `src/shared/secrets/sources/foo.descriptor.ts`
  exports a `ValueSourceDescriptor` with `id`, `labelKey`, `canWrite`,
  `isObject`, and either `paramSchema` or `configComponent`.
- [ ] **2. Main resolver** — `src/main/services/secrets/resolvers/foo.resolver.ts`
  exports a `ValueSourceResolver` implementing `read` (and `write` when
  `canWrite: true`).
- [ ] **3. Main registration** — `registerBuiltinSources()` in
  `src/main/services/secrets/mainSourceRegistry.ts` registers both the
  descriptor and the resolver.
- [ ] **4. Renderer registration** — `registerRendererSources()` in
  `src/renderer/src/secrets/registerRendererSources.ts` registers the
  descriptor (descriptor only — no resolver).
- [ ] **5. Persistence is automatic** — no edits needed to `KeyValue.fromPlain`,
  `valuePersistence.ts`, `valueHelpers.ts`, or `castValue.ts`.
- [ ] **6. UI** — either `paramSchema` renders for free in `SecretSourceConfig.tsx`,
  or a custom component is added to its `configComponents` map. ECUI components
  only; tooltips via `HeaderHoverTooltip` (never native `title`).
- [ ] **7. i18n** — `labelKey` and every param `labelKey`/`placeholderKey` added
  to **all 27** locale files under `src/renderer/locales/`.
- [ ] **8. Tests** — resolver unit test, component render test, and a variable of
  the new source added to the e2e demo fixture + BDD scenario.
- [ ] **9. Gate** — `npm run lint && npm run typecheck && npx vitest run
  src/main/services/secrets` green.

---

## The two shapes of a source

Pick the shape closest to your source before writing any code.

| Shape | When to use | Config surface | Reference |
| --- | --- | --- | --- |
| **Param-schema** | Config is one or a few short text/password/select fields the user types | Declare `paramSchema: ParamField[]` in the descriptor; `SecretSourceConfig.tsx` renders it for free | `envVar` — one field: the OS env var name |
| **Custom component** | Config is a free-form UX (a file browser, a structured form with write-field, computed params) | Set `configComponent: '<id>'` in the descriptor; add the matching React component to `SecretSourceConfig.tsx`'s `configComponents` map | `envFileSecret` — a password input that writes through to `restorm.env` |

---

## Step 1 — Shared descriptor

Create `restorm/src/shared/secrets/sources/<id>.descriptor.ts`:

```ts
import type { ValueSourceDescriptor } from '../ValueSource'

export const awsSecretsManagerDescriptor: ValueSourceDescriptor = {
  id: 'awsSecretsManager',
  labelKey: 'secrets.source.awsSecretsManager',
  // Bare string → codicon shorthand. A full ECUI Icon pulls from any library
  // (e.g. a brand mark absent from codicons):
  //   icon: { type: 'fontawesome', value: 'faAws' }
  icon: { type: 'fontawesome', value: 'faAws' },
  canWrite: false,        // true only when the resolver implements write()
  isObject: true,         // the AWS response is a JSON blob; sub-key extraction
                          // is needed (see "isObject" below)
  paramSchema: [
    {
      key: 'secretId',
      labelKey: 'secrets.param.awsSecretId',
      kind: 'text',
      required: true,
      placeholderKey: 'secrets.param.awsSecretIdPlaceholder'
    },
    {
      key: 'region',
      labelKey: 'secrets.param.awsRegion',
      kind: 'text',
      required: true,
      placeholderKey: 'secrets.param.awsRegionPlaceholder'
    },
    {
      key: 'path',
      labelKey: 'secrets.param.awsSecretPath',
      kind: 'text',
      required: false,
      placeholderKey: 'secrets.param.awsSecretPathPlaceholder'
    }
  ]
}
```

### Descriptor fields reference

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | `string` | Stable identifier persisted in every `SecretValue` in `.restorm` files. **Never rename after release** — existing persisted values reference it. |
| `labelKey` | `string` | i18n key used in the "Others ▸" menu item and the type badge. |
| `icon` | `string \| Icon \| undefined` | Glyph shown for the source both in the "Others ▸" menu and on the value's type-indicator button (replacing the generic lock). A bare string is a [codicon](https://microsoft.github.io/vscode-codicons/) name (`'cloud'`); a full ECUI `Icon` (`{ type: 'fontawesome', value: 'faAws' }`) pulls from any library `IconView` supports (codicon, fontawesome, material, simpleicons, phosphor, …) — use it for brand marks absent from codicons. Defaults to a lock when omitted. |
| `canWrite` | `boolean` | Whether the resolver also implements `write`. Controls whether the execution engine attempts to call `write` after a variable assignment. |
| `isObject` | `boolean` | When `true`, the resolver's `read` returns a JSON object. `SecretHydrationService` extracts the string at `params.path` via dot-path navigation (e.g. `token.access` → `payload.token.access`). The user sets `path` in the `paramSchema` or custom config. When `false`, `read` returns a plain string and `params.path` is ignored. |
| `paramSchema` | `ParamField[] \| undefined` | Declares config fields. When present and non-empty, `SecretSourceConfig.tsx` renders them as ECUI controls automatically — no React code needed. |
| `configComponent` | `string \| undefined` | Named key for a custom React component in `SecretSourceConfig.tsx`'s `configComponents` map. Used when `paramSchema` is not rich enough. Mutually exclusive with `paramSchema` in practice (if both are set, `paramSchema` wins in the current renderer). |
| `setupComponent` | `string \| undefined` | Reserved for a one-time setup/auth flow that runs before the first read. Not yet wired in the renderer; declare it for forward compatibility if your source needs an OAuth dance or credential file bootstrap. |

### `ParamField` kind values

| `kind` | Renders as | Notes |
| --- | --- | --- |
| `'text'` | Plain `InputBox` | Use for non-sensitive config like region, project id, secret name. |
| `'password'` | Masked `InputBox` | Use for API keys typed directly into the UI (prefer `envFileSecret` for values the user wants stored at rest). |
| `'select'` | `SelectBox` | Supply `options: { value, labelKey }[]`. |

---

## Step 2 — Main resolver

Create `restorm/src/main/services/secrets/resolvers/<id>.resolver.ts`:

```ts
import type { ValueSourceResolver, ResolveCtx } from '../../../../shared/secrets/ValueSource'

export const awsSecretsManagerResolver: ValueSourceResolver = {
  id: 'awsSecretsManager',

  async read(params: Record<string, unknown>, ctx: ResolveCtx): Promise<unknown> {
    const secretId = typeof params.secretId === 'string' ? params.secretId : ''
    const region   = typeof params.region   === 'string' ? params.region   : ''
    if (secretId === '') throw new Error('awsSecretsManager: secretId is empty')
    if (region   === '') throw new Error('awsSecretsManager: region is empty')

    // Honour AbortSignal when the caller cancels the run.
    if (ctx.signal?.aborted) throw new Error('aborted')

    // … AWS SDK call here …
    // return the raw parsed JSON so SecretHydrationService can extract
    // the sub-key when params.path is set (isObject: true).
    return { token: { access: '…' } }
  }

  // Omit write() when canWrite: false.
}
```

Key invariants:

- **`id` must match the descriptor's `id`** — the registry looks up the resolver
  by this string.
- **Always check `ctx.signal?.aborted`** before long I/O. `SecretHydrationService`
  passes the run's abort signal so a `Stop` cancels in-flight secret fetches.
- **Return `unknown`, not `string`, when `isObject: true`.** The service calls
  `extractSubKey(payload, params.path)` from
  `restorm/src/shared/secrets/ValueSource.ts` to produce the final string.
- **Reject with a human-readable `Error`** for missing config, auth failure, or
  network error — the rejection message surfaces in the execution run log.

---

## Step 3 — Register in main

Open `restorm/src/main/services/secrets/mainSourceRegistry.ts` and add two
lines inside `registerBuiltinSources()`:

```ts
import { awsSecretsManagerDescriptor } from '../../../shared/secrets/sources/awsSecretsManager.descriptor'
import { awsSecretsManagerResolver }   from './resolvers/awsSecretsManager.resolver'

export function registerBuiltinSources(): void {
  // … existing sources …

  valueSourceRegistry.register(awsSecretsManagerDescriptor)
  resolvers.set(awsSecretsManagerResolver.id, awsSecretsManagerResolver)
}
```

`registerBuiltinSources` is idempotent (`valueSourceRegistry.register` overwrites
by id; `resolvers.set` overwrites by key), so calling it multiple times — which
tests do — is safe.

---

## Step 4 — Register in renderer

Open `restorm/src/renderer/src/secrets/registerRendererSources.ts` and add one
line:

```ts
import { awsSecretsManagerDescriptor } from '../../../shared/secrets/sources/awsSecretsManager.descriptor'

export function registerRendererSources(): void {
  // … existing sources …
  valueSourceRegistry.register(awsSecretsManagerDescriptor)
}
```

**Why a separate call?** Main and renderer are separate Electron bundles. Each
module graph owns an independent `valueSourceRegistry` singleton instance
(declared in `restorm/src/shared/secrets/valueSourceRegistry.ts`). The shared
source files are bundled twice — once into `dist/main`, once into
`dist/renderer` — so registering in one bundle has no effect on the other.

**Descriptors only, no resolvers.** Resolution runs entirely in the main process
where it can reach the OS environment, the file system, and the network. The
renderer only needs the descriptor (labels, param schema, config-component id)
to drive the type-pick menu and the config UI. Resolved plaintext is never sent
to the renderer — `SecretValue.resolved` carries `@NonSerialised()` and its
`toJSON()` explicitly strips it before any serialization path runs.

---

## Step 5 — Persistence is automatic

No edits are needed to:

- `restorm/src/shared/models/KeyValue.ts` (`KeyValue.fromPlain`)
- `restorm/src/main/services/valuePersistence.ts`
- `restorm/src/shared/utils/valueHelpers.ts`
- `restorm/src/main/services/castValue.ts`

This is the key payoff of the secrets foundation design. Every `SecretValue`
in the document tree serializes to the same canonical shape regardless of
source:

```json
{ "type": "secret", "source": "awsSecretsManager", "params": { "secretId": "my/secret", "region": "eu-west-1", "path": "token.access" } }
```

`KeyValue.fromPlain` already knows how to deserialize `type: 'secret'` into a
`SecretValue(source, params)`. Adding a new `source` value requires no parser
change — the shape is the same; only the `source` string and `params` content
differ. Existing loaded files keep working even before the new source is
registered (the SecretValue is deserialized, just unresolvable until the source
is registered).

### Loading / error feedback is automatic too

You do not wire any UI to surface a source's resolving spinner or error badge.
`ContextService` (main) eagerly hydrates every item's direct secrets — and the
secrets referenced through the *active* environment — then broadcasts per-item
and per-variable status (`resolving` / `errored`) over
`context:item-secrets-status`. The renderer stores (`secretResolutionStore`,
`secretErrorStore`, `secretItemStatusStore`) drive the spinner + error glyph on
the KV-table cell, the workbench tab, and the sidebar tree for **any** source.
A resolver that throws a human-readable `Error` (Step 2) is all it takes for the
red error contour + tooltip to show that exact message. The only contract you
owe is: `read` resolves for success, rejects with a clear `Error` for failure.

---

## Step 6 — UI

### Param-schema sources (automatic)

When `descriptor.paramSchema` is set and non-empty, no React code is needed.
`SecretSourceConfig.tsx` at
`restorm/src/renderer/src/components/TypedValueField/sources/SecretSourceConfig.tsx`
renders each `ParamField` as the matching ECUI control (`InputBox` for `text`/
`password`, `SelectBox` for `select`) and writes changes into `value.params`.
The `envVar` source uses this path: its single `name` field renders as an
`InputBox` with the `secrets.param.envVarName` label.

The "Others ▸" submenu in `TypedValueField.tsx` enumerates
`valueSourceRegistry.list()` automatically, so a registered descriptor appears
in the menu without any menu code changes.

### Custom-component sources

When `descriptor.configComponent` is set, add a React component to the
`configComponents` map in `SecretSourceConfig.tsx`:

```tsx
// Inside SecretSourceConfig.tsx

const MyCustomConfig: React.FC<ConfigComponentProps> = ({ value, onChange }) => {
  const { t } = useTranslation()
  // Use ECUI components only. Wrap in HeaderHoverTooltip for button hover labels.
  return (
    <InputBox
      value={…}
      password
      onChange={(next) => {
        const updated = cloneSecret(value, value.params)
        // …
        onChange(updated)
      }}
      options={{ placeholder: t('secrets.source.mySourcePlaceholder', 'Credential') }}
    />
  )
}

const configComponents: Record<string, React.FC<ConfigComponentProps>> = {
  envFileSecret: EnvFileSecretConfig,
  mySource: MyCustomConfig       // ← add your entry
}
```

UI hard rules (same as the protocol playbook):

- **ECUI components only** — `Button`, `InputBox`, `SelectBox`, etc. from
  `electron-core-ui`. No bare `<input>` or `<button>`.
- **Hover tooltips via `HeaderHoverTooltip`**
  (`restorm/src/renderer/src/components/MainView/HeaderHoverTooltip.tsx`),
  never a native `title` attribute.
- **`aria-label`** stays on interactive elements for screen-reader accessibility;
  drop the native `title` prop in its place.

### Masking invariant

The resolved plaintext must never appear in the renderer DOM. In custom
components:

- Do not read `value.resolved` to display the current credential — it is
  `undefined` in the renderer (the main process sets it, never serializes it
  back).
- When `canWrite: true`, a write-field captures what the user types as
  `value.resolved` (the plaintext to be persisted), but never renders a
  previously stored value. The `EnvFileSecretConfig` component in
  `SecretSourceConfig.tsx` is the reference for this pattern.

---

## Step 7 — i18n

Add the `labelKey` and every param `labelKey`/`placeholderKey` to **every**
locale file under `restorm/src/renderer/locales/`. The 27 locales are:
`cs da de el en es fi fr hr hu id it ja ko nb nl pl pt ro sq sr sv tr uk vi zh-CN zh-TW`.

The `secrets` section already exists in every file. Extend it:

```json
// en/translation.json
"secrets": {
  "source": {
    "awsSecretsManager": "AWS Secrets Manager"
  },
  "param": {
    "awsSecretId":             "Secret ID",
    "awsSecretIdPlaceholder":  "my-app/database-password",
    "awsRegion":               "Region",
    "awsRegionPlaceholder":    "eu-west-1",
    "awsSecretPath":           "Sub-key path",
    "awsSecretPathPlaceholder": "token.access"
  }
}
```

If you cannot translate a phrase into a locale's language, still add the key
with the English value as a placeholder — a missing key silently falls back to
`en`, making the bug invisible in dev and only visible to users of that locale.
(This is the "Translations span every locale" rule in `CLAUDE.md`.)

A small Node script that reads each file, merges the new keys, and writes back
with `JSON.stringify(obj, null, 2) + '\n'` keeps the diff additive (all 27
locale files have 2-space indentation and a trailing newline).

---

## Step 8 — Testing

### 8.1 — Unit tests for the resolver

Add `restorm/src/main/services/secrets/resolvers/<id>.resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mySourceResolver } from './<id>.resolver'

const ctx = { scopeId: 'test' }

describe('<id>Resolver', () => {
  it('reads a present credential', async () => {
    // … set up preconditions (env var, mock SDK, …) …
    const result = await mySourceResolver.read({ /* valid params */ }, ctx)
    expect(result).toBe('expected-value')
  })

  it('rejects when required params are missing', async () => {
    await expect(mySourceResolver.read({}, ctx)).rejects.toThrow(/<error phrase>/)
  })

  // For isObject: true sources — the resolver returns an object:
  it('returns an object payload for isObject sources', async () => {
    const payload = await mySourceResolver.read({ /* valid params */ }, ctx)
    expect(typeof payload).toBe('object')
  })

  // For canWrite: true sources:
  it('writes the value back', async () => {
    await mySourceResolver.write({ /* valid params */ }, 'new-value', ctx)
    const read = await mySourceResolver.read({ /* valid params */ }, ctx)
    expect(read).toBe('new-value')
  })
})
```

Also verify the sub-key extraction path when `isObject: true`. The utility
`extractSubKey` lives in
`restorm/src/shared/secrets/ValueSource.ts` and is exercised by the
`SecretHydrationService` tests:

```ts
import { extractSubKey } from '../../../../shared/secrets/ValueSource'

it('extracts a dot-path sub-key from the resolver payload', () => {
  const payload = { token: { access: 'my-token' } }
  expect(extractSubKey(payload, 'token.access')).toBe('my-token')
})

it('throws on a missing path segment', () => {
  expect(() => extractSubKey({ a: 1 }, 'a.b')).toThrow(/not found/)
})
```

### 8.2 — Registration integration

Add a registration smoke-test in the resolver test file (pattern from
`envVar.resolver.test.ts`):

```ts
import { registerBuiltinSources, getResolver } from '../mainSourceRegistry'
import { valueSourceRegistry } from '../../../../shared/secrets/valueSourceRegistry'

describe('registerBuiltinSources with <id>', () => {
  it('registers the descriptor', () => {
    registerBuiltinSources()
    const d = valueSourceRegistry.get('<id>')
    expect(d).toBeDefined()
    expect(d?.canWrite).toBe(/* true or false */)
  })

  it('getResolver returns the <id> resolver', () => {
    registerBuiltinSources()
    expect(getResolver('<id>')?.id).toBe('<id>')
  })
})
```

> **Exercising cancellation / slow I/O.** When you need a slow,
> abort-honouring resolver to test that `SecretHydrationService` cancels
> in-flight fetches, do **not** ship a fake source in the production registry.
> Register a throwaway resolver inside the test via the test-only hook
> `registerResolverForTests(resolver)` from `mainSourceRegistry.ts` — it sets
> the resolver by id without touching the descriptor registry. The hydration
> cancellation tests in
> `restorm/src/main/services/secrets/envFolderSecretHydration.test.ts` use this
> pattern with an inline `slowTest` resolver that honours `ctx.signal`.

### 8.3 — Component render test

Open
`restorm/src/renderer/src/components/TypedValueField/TypedValueField.menu.test.tsx`
and verify the new source appears in the "Others ▸" submenu. The test calls
`registerRendererSources()` in its `beforeAll` — your descriptor is picked up
automatically once registered there.

### 8.4 — E2E: extend the demo fixture

The secrets-sources e2e suite is anchored to two files:

- **Demo collection**: `restorm/tests/e2e/samples/secrets-sources-demo.restorm`
  — the `.restorm` file opened by the test. Add a variable or request header
  that uses the new source. Keep a second variable using `envVar` so the
  existing scenario continues to exercise masking.
- **BDD feature + steps**: `restorm/tests/e2e/bdd/secrets-sources/` —
  `features/secrets-sources.feature` and `steps/secrets-sources.steps.ts`.

Add at least one scenario asserting:

```gherkin
Scenario: <id> secret resolves on the wire but never leaks to the DOM
  Given I open the secrets-sources demo collection
  When I run the "<request using the new source>" request
  Then the response should reflect the resolved secret
  And the variable cell should not show the resolved plaintext
```

The masking assertion (`expect(view).not.toContainText(SECRET_PLAINTEXT)`) is
non-negotiable: a scenario that only checks the resolved value reached the
server, without verifying it stayed out of the DOM, does not guard against
the class of bug the foundation was designed to prevent.

For sources that require external infrastructure (a real AWS account, a remote
vault), add a `SKIP_<ID>_E2E=1` env var guard in the `Given` step (precedent:
`SKIP_GITEA_E2E` in the protocol e2e). CI never sets it; local contributors on
constrained environments can opt out gracefully.

#### Run-log golden per source

Beyond the wire/DOM assertions above, each secret source also gets its **own
scenario** in the demo fixture, named after the source type (e.g. `EnvVar`),
containing an **assert** node that validates the resolved value. That scenario
is captured as a committed run-log golden — `secrets-sources-demo.<source>-runlog.yaml`
next to the sample under `tests/e2e/samples/` — so the whole
secret-resolution + execution pipeline is snapshot-guarded against regression
(an `assert` PASS on the resolved plaintext is what the golden encodes).

The run-log capture reuses the scenario-runlog helpers
(`tests/e2e/bdd/scenario-runlog/runLogShared.ts`, `normalizeRunLogYaml`) but
lives in the secrets-sources suite (its fixture injects `RESTORM_E2E_SECRET`,
so the `envVar` source resolves) — see
`tests/e2e/bdd/secrets-sources/features/secrets-sources-runlog.feature` and
`steps/secrets-sources-runlog.steps.ts`. The regen workflow mirrors the
scenario-runlog README: a missing golden without the flag is a hard failure
(never a silent self-bless), and the golden is captured — never hand-written —
from the live copy:

```bash
npm run build                                                          # only if app/main code changed
UPDATE_RUNLOG_GOLDEN=1 npm run test:e2e -- --project=secrets-sources   # writes the goldens
```

Then read the generated YAML to sanity-check it (the `assert` node should show
a PASS on the resolved value), and run **again without the flag** so it
re-compares green — proving the run is deterministic — before committing. The
secrets-sources demo is a NON-shared sample, so its goldens may legitimately
carry the resolved secret plaintext (the run echoes it back), the same way the
auth-login run-log golden carries run-specific values.

---

## Step 9 — Gate

```bash
npm run lint && npm run typecheck && npx vitest run src/main/services/secrets
```

Then verify on the running app: the new source should appear in the "Others ▸"
submenu of any `TypedValueField` that allows secrets. A renderer change rides
HMR; a `src/main/` or `src/main/preload/` change needs a full restorm restart.
Confirm:

- The descriptor's label renders correctly in the menu.
- Selecting the source switches the value to a `SecretValue` with the correct
  `source` id.
- The config fields (or custom component) render and accept input.
- A request using the new source resolves the credential before dispatch.
- The resolved plaintext does not appear in the request tab or the variables
  table DOM.

---

## Reference implementations

| Source | Descriptor | Resolver | Pattern |
| --- | --- | --- | --- |
| `envVar` | `src/shared/secrets/sources/envVar.descriptor.ts` | `src/main/services/secrets/resolvers/envVar.resolver.ts` | Simplest: `paramSchema`, `isObject: false`, read-only, synchronous. |
| `envFileSecret` | `src/shared/secrets/sources/envFileSecret.descriptor.ts` | `src/main/services/secrets/resolvers/envFileSecret.resolver.ts` | Rich: `configComponent`, `isObject: false`, `canWrite: true`, file I/O. |

Pick the closest match. A simple cloud-vault source that returns a JSON payload
(like AWS Secrets Manager) follows the `envVar` shape (`paramSchema`, read-only)
but sets `isObject: true` to enable dot-path sub-key extraction.

The `SecretHydrationService` at
`restorm/src/main/services/secrets/SecretHydrationService.ts` is the
orchestration layer — read it alongside the resolver to understand how the
cache, the `params.path` extraction, and the `invalidate` / `invalidateAll`
refresh paths work.

---

## Per-source PR checklist

```
- [ ] Descriptor created at src/shared/secrets/sources/<id>.descriptor.ts.
- [ ] Resolver created at src/main/services/secrets/resolvers/<id>.resolver.ts
      and implements read() (+ write() when canWrite: true).
- [ ] Both descriptor + resolver registered in mainSourceRegistry.ts (registerBuiltinSources).
- [ ] Descriptor registered in registerRendererSources.ts (renderer only — no resolver).
- [ ] No edits to KeyValue.fromPlain / valuePersistence.ts / valueHelpers.ts / castValue.ts.
- [ ] paramSchema or configComponent configured correctly; UI uses ECUI components only.
- [ ] Hover tooltips via HeaderHoverTooltip, not native title attribute.
- [ ] labelKey + every param labelKey/placeholderKey present in all 27 locale files.
- [ ] Resolver unit tests cover: read (happy path), missing params (error), isObject sub-key,
      canWrite write (if applicable), AbortSignal.
- [ ] Registration smoke-test in the resolver test file (registerBuiltinSources + getResolver).
- [ ] SecretSourceConfig component render test passes for the new source.
- [ ] secrets-sources-demo.restorm extended with a variable/header using the new source.
- [ ] BDD scenario added asserting resolution AND masking (plaintext absent from DOM).
- [ ] Per-source run-log scenario (named after the source, with an assert node) added to the
      demo fixture + captured as secrets-sources-demo.<source>-runlog.yaml via UPDATE_RUNLOG_GOLDEN=1.
- [ ] SKIP_<ID>_E2E guard if the source requires external infrastructure.
- [ ] npm run lint && npm run typecheck && npx vitest run src/main/services/secrets green.
- [ ] Manual verification on the running app: menu item visible, config renders, secret resolves.
```
