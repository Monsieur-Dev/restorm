# Privacy — consent, scrubbing, and outbound visibility

Three generic pieces that together let an app send diagnostics without betraying
its users. They are independent — use the scrubber alone if that's all you need —
but they are designed to compose into one rule:

> Nothing optional leaves the process unless the user said yes, and whatever
> leaves has been stripped of everything that identifies them.

| Piece | Where | Answers |
| --- | --- | --- |
| `ConsentService` | `main/services/privacy/ConsentService.ts` | may we send this? |
| `scrubPayload` / `assertScrubbed` | `shared/privacy/scrub.ts` | is this payload safe to send? |
| `ConsentFirewallExemption` | `main/services/privacy/ConsentFirewallExemption.ts` | can the destination even be reached? |

The host app supplies the vocabulary: ECUI knows there are named consent gates
and declared hosts, and nothing about what `crash` or `telemetry` mean.

## Consent

### Model

A **gate** is a named yes/no, backed by a settings key:

```typescript
{ id: 'telemetry', settingKey: 'privacy:telemetry', defaultGranted: false }
```

The boolean lives in the settings store, so the Preferences toggle is the single
editable source of truth and inherits its persistence, workspace overlay and
change broadcast for free. The **audit trail** — when the value was decided, and
against which privacy-policy version — lives beside it in a small consent file,
because "when did they agree, and to what?" is a question a bare boolean cannot
answer.

### Wiring

```typescript
import { ConsentService, makeConsentFileStore } from 'electron-core-ui/main'
import { join } from 'node:path'
import { app } from 'electron'

const consent = new ConsentService({
  gates: [
    { id: 'crash', settingKey: 'privacy:crashReports', defaultGranted: true },
    { id: 'telemetry', settingKey: 'privacy:telemetry', defaultGranted: false }
  ],
  settings: mySettingsPort,                    // getBoolean / setBoolean / subscribe
  store: makeConsentFileStore(join(app.getPath('userData'), 'privacy', 'consent.json')),
  policyVersion: '2026-07-29',
  // Optional: a value that is not purely the user's to choose.
  resolveOverride: (gate) => (gate === 'crash' && plan() === 'community' ? 'forced-on' : null)
})

if (consent.canSend('telemetry')) { /* … */ }
```

### API

| Member | Behaviour |
| --- | --- |
| `canSend(gateId): boolean` | the one question that matters. An **unknown gate is `false`** — a typo fails closed |
| `getDecision(gateId): ConsentDecision \| null` | value + `consentedAt` + `policyVersion` + `source` |
| `listDecisions(): ConsentDecision[]` | every gate, in declaration order |
| `setGranted(gateId, granted)` / `revoke(gateId)` | drive a gate from a consent dialog |
| `onChange(listener)` | fires after the audit trail is written; returns an unsubscribe |
| `revalidate()` | re-announce every decision because an input the service cannot observe moved — see below |
| `dispose()` | drop every settings subscription |

`ConsentDecision.source` reports how the value was arrived at — `default`
(nobody has decided), `user`, `forced-on`, `forced-off` — so a UI can explain a
value the user did not pick instead of silently contradicting their toggle.

### `revalidate()` — when the override moves

`resolveOverride` is a function over state the service knows nothing about (an
account plan, a policy fetched at runtime). When that state changes, every
`getDecision` call returns the new answer immediately — but nothing tells
existing SUBSCRIBERS to go and re-read it, so anything that armed itself on the
old answer stays armed on it.

For a gate that forces sending ON for one class of account and leaves it to the
user for another, that gap is the difference between stopping the moment someone
gains the right to refuse and carrying on until they happen to touch a toggle.
Call `revalidate()` from whatever owns the overridden state:

```typescript
// on login / logout / plan change
consent.revalidate()
```

It cannot be automatic: the service is handed a function, not an observable.

### Deliberate non-behaviours

Three things it does **not** do, each one load-bearing:

- **An override is never recorded.** The trail captures what the USER chose; if
  a plan downgrade could rewrite it, the trail would be worthless as evidence.
- **A bumped `policyVersion` does not re-stamp an unchanged value.** Leaving the
  stale version visible is precisely what lets a host detect "consented to older
  terms" and re-ask, rather than laundering old consent into new terms.
- **A gate still on its default is left unrecorded.** `source: 'default'`
  (nobody decided) must stay distinguishable from `source: 'user'`.

### On-disk format

`<userData>/privacy/consent.json`:

```json
{
  "version": 1,
  "gates": {
    "telemetry": {
      "granted": true,
      "consentedAt": "2026-07-29T10:00:00.000Z",
      "policyVersion": "2026-07-29"
    }
  }
}
```

Both halves of `makeConsentFileStore` are non-throwing: an unreadable file means
"no trail yet" (the user's actual choice lives in the settings store and is
unaffected), and a failed write is logged and swallowed, because a read-only disk
must degrade the audit trail rather than break consent resolution on a hot path.

## Scrubbing

A crash report is the richest leak vector an app has: a stack trace carries
absolute file paths (whose home segment IS the user's name), and an SDK's
breadcrumb trail carries the URLs, `Authorization` headers and request bodies of
every call the user made.

```typescript
import { scrubPayload, assertScrubbed } from 'electron-core-ui/main'

const clean = scrubPayload(event, { homeDir: os.homedir() })
assertScrubbed(clean, { homeDir: os.homedir() })   // throws PayloadNotScrubbedError
transport.send(clean)
```

`scrubPayload` rewrites; `assertScrubbed` throws unless scrubbing again would
change nothing. Defining the gate in terms of the rewriter — rather than as a
parallel set of detectors — is what makes the contract hold by construction: the
two cannot disagree, so neither a missing detector nor an unrecognised rewrite
can produce a false pass. Call `assertScrubbed` **last**, after the transport has
built its final payload, so a bug in a future transform surfaces as a thrown
error instead of a silent leak.

The structural walk follows `JSON.stringify` semantics rather than a plain key
walk, because the difference is a leak: `new URL(...)` has no enumerable keys yet
serialises to its full href, query string included. So a `toJSON()` object is
scrubbed (and checked) through what serialisation will actually see, an `Error`
through its non-enumerable `message` / `stack`, and anything still nested past
`maxDepth` or forming a true cycle is a violation rather than a skipped
subtree.

| Rule | Default treatment |
| --- | --- |
| Sensitive keys (`Authorization`, `*token*`, `*apikey*`, `cookie`, `*secret*`, …) | value → `[redacted]`, matched case- and separator-insensitively (`x-api-key` = `xApiKey`) |
| Body keys (`body`, `requestBody`, `payload`, `data`, …) | dropped wholesale → `[redacted-body]` |
| JWTs, `Bearer <blob>`, 32+ char base64url blobs | → `[redacted-token]` |
| http(s) / ws(s) URLs | → `[redacted-url]`; `urlPolicy: 'host'` keeps `scheme://host` |
| Home directory in a path or `file://` URL | → `~` (keeps the rest of the frame) |
| E-mail addresses, IPv4 literals | → `[redacted-email]` / `[redacted-ip]` |
| Caller-supplied `redactValues` | → `[redacted]` wherever they appear |
| Caller-supplied `preserveKeys` | STRING value under an exact-named key passes **verbatim**, exempt from every rule above |

Two calibrated choices. `author` is **not** treated as a credential even though
it contains `auth` — bare `auth` would swallow a legitimate field, and `token` /
`authorization` cover the real cases. `data`, conversely, **is** dropped
unconditionally: it is what axios calls the body on both sides (`config.data`
request, `response.data` response) and what fetch wrappers copy. That costs an
SDK breadcrumb's `data` object, which is real debuggability lost — the trade is
deliberate. Scoping `data` to known parent keys was tried and rejected: it
silently missed `config.data`, and the next client to invent its own wrapper name
would have slipped through the same way. A consumer that needs a specific `data`
field back should rename it rather than loosen the rule. And file paths keep their structure rather
than being blanked: the username is the PII, the rest of the path is the whole
value of a stack trace.

`ScrubOptions`: `redactKeys`, `redactValues`, `preserveKeys`, `urlPolicy`,
`homeDir`, `maxDepth` (default 8). True cycles collapse to `[circular]` — a merely
REPEATED reference does not, so a payload that points at the same `user` object
twice keeps both. Over-deep values collapse to `[redacted-depth]`.

`preserveKeys` is the one calibrated hole in the fail-closed posture, and it is
deliberately narrow. Some transports carry structural identifiers that LOOK like
secrets: a Sentry `event_id` / `trace_id` is 32 hex characters, the exact shape
the entropy catch-all treats as a token. Redacting them is not merely
over-cautious — it corrupts the field the ingest endpoint validates, so an event
with a `[redacted-token]` `event_id` is rejected with HTTP 400 and the whole
report is dropped. `preserveKeys` names such keys (matched loosely, like
`redactKeys`) so their **string** value passes untouched and `assertScrubbed`
agrees. It is scoped to strings only: a nested object under a preserved key is
still walked in full, so it cannot be used to smuggle a subtree past the gate.
Name only keys whose value the producer generates and the consumer requires
verbatim — never one that could carry user content.

Under `urlPolicy: 'host'` the surviving `scheme://host` is left alone by the IP
and high-entropy rules, so an IP-literal destination stays readable. That is the
point of opting into the policy; use the default `'strip'` if the destination is
itself sensitive.

`findScrubViolations(value, options)` returns `{ path, rule }[]` without
throwing — useful in tests. `PayloadNotScrubbedError.violations` carries the same
list, and its message names paths and rules only, never the offending value.

## Outbound visibility

`ConsentFirewallExemption` reconciles a set of consent-gated hosts against the
live answers:

```typescript
const exemption = new ConsentFirewallExemption(
  permissionService,
  [{ host: 'eu.i.example.com', consentGate: 'telemetry' }],
  (gate) => consent.canSend(gate)
)
consent.onChange(() => exemption.sync())
exemption.sync()
```

`sync()` is idempotent and only ever removes hosts it registered itself.
Revocation removes the host from the allowlist, which means **the firewall**
blocks a retried queued event — not a promise made by the sender.

One caveat: `systemAllowedHosts` is a plain set with no reference counting, so
two owners registering the same host would clobber each other on removal. Give
each owner distinct hosts.

Pair it with `permissionService.declareSystemEndpoint(...)` so each host also
appears in the firewall panel's read-only outbound-services list, switched-off
rows included. See [`docs/Firewall/README.md`](../Firewall/README.md#outbound-services--the-apps-own-traffic).
