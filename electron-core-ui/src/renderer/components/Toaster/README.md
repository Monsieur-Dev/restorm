# `<Toaster>` + `toasterService`

Portal-rendered, **service-backed toast container**. A `<Toaster id="…">` mounted anywhere in the tree registers with the global `toasterService` under the given id. Anything with a reference to that service — components, non-React code, other windows going through IPC — can push toasts into it by id, without prop drilling and without React context.

## When to use it

- You need transient notifications (success, info, warn, error) that do **not** block the UI.
- You want a single sink for app-wide status messages that can live alongside the statusbar or titlebar.
- You want imperative pushes from arbitrary code paths — `toasterService.push('demo', { title, body })` — not a `<Toast>`-per-event JSX tree.

For confirmations (modal), inline form errors, or persistent alerts that demand action, reach for `<Modal>` or `<Callout>` instead.

## Architecture

Four pieces in `electron-core-ui/renderer`:

| Piece | Role |
| --- | --- |
| `toasterService` (singleton) | Owns the state of every registered toaster. Source of truth for `toasts`, `showFrame`, `doNotDisturb`. Emits `toastsChange` / `showFrameChange` / `doNotDisturbChange` events. |
| `useToasts(id)` | React hook — reactive getters (`toasts`, `showFrame`, `doNotDisturb`) + imperative actions (`pushToast`, `dismissToast`, `clearToasts`, `setShowFrame`, `setDoNotDisturb`, etc.) bound to a specific toaster id. |
| `<Toaster id={…}>` | Portal-rendered container. Registers/unregisters with the service and renders the current toasts in its anchored corner. |
| `<Toast>` | Internal. Renders a single toast with its title/body, close button, optional auto-dismiss progress bar, and enter/exit animations. Not exported — always pushed through the service. |

The decoupling means you can push toasts from anywhere — event-bus handlers, IPC subscribers, async workers — with no reference to a React node.

## Minimal usage

Mount the container once per window/workbench, then push imperatively:

```tsx
import { Toaster, toasterService } from 'electron-core-ui/renderer'

export function App(): JSX.Element {
  return (
    <>
      {/* … rest of your app … */}
      <Toaster id="global" position="bottom-right" />
    </>
  )
}

// Anywhere else:
toasterService.push('global', {
  title: 'Saved',
  body: 'Your changes have been saved.',
  durationMs: 4000
})
```

`durationMs` is optional — omit for a toast that stays until the user dismisses it.

## Framed vs. transparent mode

Each toaster has a `showFrame` boolean managed by the service. When `false` (default), toasts float standalone in the anchored corner. When `true`, the toaster renders a tooltip-styled bordered container with a sticky header that provides **Clear all**, **Do not disturb**, and **Hide** buttons. A natural pairing is the `<StatusBarBellButton>` component shipped with the library:

```tsx
import { Statusbar, StatusBarBellButton } from 'electron-core-ui/renderer'

<Statusbar>
  <StatusBarBellButton toasterId="global" className="right-aligned" />
</Statusbar>
```

`<StatusBarBellButton>` is a thin `<StatusbarElement>` wrapper that renders a `codicon-bell` glyph, calls `toasterService.toggleVisibility(toasterId)` on click, and overlays a small red badge at the bottom-right when at least one stored toast still has `seen === false`. The badge disappears automatically as soon as each toast has been rendered with opacity > 0.

Clicking the bell toggles the framed panel; clicking the header's chevron collapses it back.

## Props — `<StatusBarBellButton>`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `toasterId` | `string` | — | Id of the `<Toaster>` this bell targets. |
| `className` | `string?` | — | Forwarded to the underlying `<StatusbarElement>` (e.g. `'right-aligned'`). |
| `ariaLabel` | `string?` | `'Toggle notifications'` | Accessible label for the glyph. |
| `'data-testid'` | `string?` | `'statusbar-toaster-bell'` | Badge test id is `${data-testid}-badge`. |

## Update-in-place

Pass the same `id` to `push` to update an existing toast (title/body/duration reset, animation restarts):

```ts
for (const step of ['Uploading…', '33 %', '66 %', 'Done']) {
  toasterService.push('global', { id: 'upload', title: 'Upload', body: step })
}
```

Useful for progress indicators that must not stack into N copies.

## Do Not Disturb

`toasterService.setDoNotDisturb('global', true)` silences the transparent stack — subsequent `push()` calls are still stored, but each new toast is created with `hidden: true` (and `seen: false`), so they never interrupt the user with a popup. They remain reviewable in the framed panel: opening the frame reveals every stored toast, and the `<StatusBarBellButton>` badge keeps ticking up for each unseen DND-received notification. The framed-mode header has a toggle button (`bell-slash` codicon) for user-facing control.

## Pause on hover / focus

Auto-dismiss timers pause while the pointer is over the toaster or keyboard focus is inside it. The progress bar freezes at its current width and resumes from the same point.

## Accessibility

- Root is `role="region"` with `aria-label="Notifications"`.
- Each toast is `role="status"` with the configured `aria-live` (`polite` by default, opt-in `assertive`).
- Close buttons carry `aria-label="Dismiss notification"`.
- `Escape` while a toast has focus dismisses it.
- Animations respect the component defaults; callers can override via `animationDurations`.

## Props — `<Toaster>`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | `string` | — | Registration key in the service. Unique per toaster. |
| `position` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | — | Anchor corner. |
| `width` | `number` | `450` | Container width (px). |
| `order` | `'asc' \| 'desc'` | `'desc'` | `desc`: newest closest to the anchored corner. |
| `initialShowFrame` | `boolean` | `false` | Initial framed-mode state. Uncontrolled — state lives in the service. |
| `initialDoNotDisturb` | `boolean` | `false` | Initial DND state. |
| `maxToasts` | `number` | `50` | Hard cap; oldest are dropped silently on overflow. |
| `margin` | `number` | `8` | Offset from the window edges (px). |
| `animationDurations` | `{ enter?, exit?, reflow? }` | `{ 200, 150, 200 }` | Override ms-level animation timings. |
| `'data-testid'` | `string` | — | Test id propagated to the root and the framed header buttons. |

## Input — `toasterService.push(id, input)`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | `string?` | auto uuid | When set and a toast with the same id exists, updates it in place. |
| `title` | `string` | — | Ellipsised when too long. |
| `body` | `ReactNode` | — | Arbitrary content. |
| `durationMs` | `number?` | — | Omit for indefinite (no progress bar). |
| `ariaLive` | `'polite' \| 'assertive'` | `'polite'` | ARIA live politeness. |

Returns the toast id (`''` when the toaster is in DND or not registered).

## Testing

Component tests live in `electron-core-ui/src/renderer/components/Toaster/ToasterService.test.ts`. E2E BDD helpers are published under `electron-core-ui/testing`:

- Selectors: `toasterRootSelector`, `toastByTitleSelector`, `toastCloseByTitleSelector`, `toasterClearButtonSelector`, …
- Step library: `defineToasterBddSteps({ Given, When, Then })` in `electron-core-ui/testing/playwright-bdd`.

See the demo app (`demo/src/renderer/src/components/test-tabs/ToasterTab.tsx` + `demo/tests/e2e/bdd/toaster/…`) for a full integration example: statusbar bell, framed mode toggle, update-in-place, DND, burst pushes.
