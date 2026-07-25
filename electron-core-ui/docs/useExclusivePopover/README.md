# useExclusivePopover

Mutual exclusion for anchored click-popovers: **at most one is open at a time, application-wide**.

Opening a participating popover closes every other one — across components that know nothing about each other, and across the boundary between library components and host-application components.

```ts
import { useExclusivePopover } from 'electron-core-ui/renderer'

useExclusivePopover(open, close)
```

## API

| Param | Type | Description |
| --- | --- | --- |
| `open` | `boolean` | Whether this popover is currently open. |
| `close` | `() => void` | Closes this popover. Invoked when another participant opens. |

Returns `void`.

## Why it exists

Anchored popovers usually dismiss themselves with a `document`/`window` `mousedown` listener. Nearly all of them also guard their own trigger with `onMouseDown={e => e.stopPropagation()}`, so that clicking inside one popover does not immediately dismiss it.

Those two facts combine into a bug: when the user clicks popover B's trigger while popover A is open, B's `stopPropagation` prevents the mousedown from ever reaching A's outside-click listener. A stays open, and two popovers overlap.

This hook sidesteps that by announcing on an event dispatched **directly on `document`**, which no `stopPropagation` in the bubbling path can intercept.

## Behaviour

- **Announce on open.** Each participant carries a per-instance `useId()`. When `open` flips true it dispatches the shared event; every *other* open participant runs its `close`.
- **Never closes itself.** A participant ignores its own announcement.
- **Inert while closed.** A closed popover neither announces nor is affected by others opening.
- **Unsubscribes on close/unmount**, so a stale participant cannot be closed later.
- **`close` is read through a ref**, so passing a fresh closure every render neither re-subscribes nor re-announces.

## Participation is by subscription, not by registry

There is no central list of popovers. A component joins the set purely by calling this hook, and nothing needs to know the full membership.

That property is deliberate: a registry has to be kept in sync by hand, and the failure mode of a stale registry is silent — a popover that simply never joins, discovered only when a user opens two at once. Calling the hook is the whole contract.

**When adding a new anchored click-popover, call this hook.** Components that own their open state internally should call it themselves rather than exposing a controlled `open` prop for the host to coordinate — a host cannot drive state it does not own, and consumers should not have to opt in to correct behaviour.

## Already participating

These library components join the set automatically; consumers need do nothing:

- [`IconSelect`](../IconSelect/README.md) — the icon/emoji picker, at every call site it is mounted
- [`BookmarkRibbon`](../BookmarkRibbon/README.md) — the per-ribbon rename/recolour editor
- [`BookmarkRibbonStack`](../BookmarkRibbon/README.md) — the `[+]` add-tag popover
- `AccountButton` — the account card popover
- [`StatusbarElement`](../Statusbar/README.md) — **every** element using `tooltipTrigger="click"`, enrolled by the component itself

`StatusbarElement` is the reason enrolment lives in the component rather than at each call site: a click-mode statusbar element is a popover whoever mounts it, so making it exclusive by construction covers every existing and future one. Do not add exclusivity wiring around a `StatusbarElement` — see the warning below.

## Do not wrap a participant in a second participant

A popover must announce **once**. If a host also calls this hook for a popover that already participates — for instance by rendering a helper inside a `StatusbarElement`'s content to reach `closeTooltip` — the two announcements carry different `useId()`s, so the outer one closes the inner one's host: the popover shuts itself the moment it opens.

The symptom reads as flakiness ("sometimes it closes on its own"), not as a wiring error, so it is worth stating plainly: if a component already participates, the host adds nothing.

## Not for

- **Modals and dialogs.** They have their own stacking and focus-trap semantics; a modal should not be dismissed by a popover opening behind it.
- **Hover tooltips.** These close on `mouseleave` and never overlap by click.
- **Popovers that must stay open alongside another** — for example a picker feeding a form that is itself inside a popover. Do not call the hook there.
