# GraphQL Link Status

A tiny feedback surface for the renderer's GraphQL subscription channel. Lets host apps tell the user that live updates from the main process are briefly stale, without spamming warnings in the log.

Three public pieces work together:

| Piece | Role |
|-------|------|
| `graphQLClient.onLinkStatusChange(...)` / `.getLinkStatus()` | Imperative observable over the link status. |
| `useGraphQLLinkStatus()` | React hook (built on `useSyncExternalStore`) that returns the current status. |
| `<GraphQLLinkStatusIndicator>` | Status-bar cell that renders an icon when the link is not healthy and nothing otherwise. |

## How it works

The renderer uses `graphql-sse` for subscriptions. On every network error it retries transparently — we configure it with `retryAttempts: Infinity` and a custom exponential-backoff delay (500 ms → 1 s → 2 s → 4 s → 8 s → 15 s cap, with ±30 % jitter) so the 6 subscriptions restorm opens don't hammer the server in lockstep after a disconnect. The `on.connecting` / `on.connected` events graphql-sse emits are piped into three states:

```
'ok'           — at least one connection is live.
'reconnecting' — the SSE layer is retrying. Events may be stale.
'failed'       — the link has been in 'reconnecting' for longer than
                 FAILED_AFTER_RECONNECTING_MS (default 60 s) without a
                 single successful reconnect. The retry keeps going
                 under the hood; the UI just escalates from a spinner
                 to a disconnect glyph.
```

`'failed' → 'ok'` is reachable — a late successful connect recovers the status without going through `'reconnecting'` first.

The escalation is **time-based**, not attempt-based. In distinct-connections mode graphql-sse emits `on.connecting` once per active subscription, so a single real outage fans out to N events from N subscriptions; a per-attempt counter would amplify linearly with subscription count and misrepresent a single blip as many failures. Wall-clock duration of the reconnecting window tracks "how long has the user been without live updates?" correctly regardless of how many streams the host opened.

## Using the indicator

```tsx
import {
  Statusbar,
  StatusbarElement,
  GraphQLLinkStatusIndicator
} from 'electron-core-ui/renderer'

<Statusbar>
  <StatusbarElement title={filePath} />
  {/* Hidden while the link is healthy; spinner during reconnect; disconnect glyph when failed. */}
  <GraphQLLinkStatusIndicator className="right-aligned" />
</Statusbar>
```

### Props — `<GraphQLLinkStatusIndicator>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | `string` | — | CSS class forwarded to the underlying `<StatusbarElement>` (typically `'right-aligned'`). |
| `data-testid` | `string` | `statusbar-graphql-link-status` | Test id for the outer element. The tooltip child uses `${dataTestId}-tooltip`. |
| `reconnectingLabel` | `string` | `Live updates reconnecting…` | Tooltip + `aria-label` shown while the link is reconnecting. |
| `failedLabel` | `string` | `Live updates unavailable — retrying in background` | Tooltip + `aria-label` shown after the retry budget is exceeded. |

The component reads its state via `useGraphQLLinkStatus` internally. Consumers that only need the raw value can use that hook directly and render their own UI.

## Using the hook without the indicator

```tsx
import { useGraphQLLinkStatus } from 'electron-core-ui/renderer'

function MyBanner(): JSX.Element | null {
  const status = useGraphQLLinkStatus() // 'ok' | 'reconnecting' | 'failed'
  if (status === 'ok') return null
  return <div role="alert">Live data temporarily unavailable.</div>
}
```

## Imperative API

For non-React consumers (one-off logs, telemetry, custom transport layers):

```ts
import { graphQLClient, type GraphQLLinkStatus } from 'electron-core-ui/renderer'

const initial: GraphQLLinkStatus = graphQLClient.getLinkStatus()
const unsubscribe = graphQLClient.onLinkStatusChange((next) => {
  console.log('[telemetry] GraphQL link', next)
})
// ...
unsubscribe()
```

Listeners fire once per distinct transition — consecutive `reconnecting` attempts below the fail threshold don't re-notify.

## Tuning the backoff + failure escalation

The constants live next to the implementation:

```ts
import {
  INITIAL_RETRY_DELAY_MS,        // 500
  MAX_RETRY_DELAY_MS,            // 15_000
  JITTER_FACTOR,                 // 0.3 (±30 %)
  FAILED_AFTER_RECONNECTING_MS   // 60_000 (1 minute)
} from 'electron-core-ui/renderer'
```

They're exports for visibility + tests; host apps shouldn't need to override them.

## Source

- Service: `electron-core-ui/src/renderer/services/GraphQLClient.ts`
- State + backoff helper: `electron-core-ui/src/renderer/services/graphqlLinkStatus.ts`
- Hook: `electron-core-ui/src/renderer/hooks/useGraphQLLinkStatus.ts`
- Component: `electron-core-ui/src/renderer/components/GraphQLLinkStatus/GraphQLLinkStatusIndicator.tsx`
