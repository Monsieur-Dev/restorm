# ChatBubble

A reusable incoming / outgoing speech bubble for conversation-style surfaces (the MCP logs viewer, and any future chat-like UI).

## Overview

`ChatBubble` is the shared primitive for a single message in a back-and-forth. It has two variants:

- **`incoming`** — a received message, aligned left (e.g. a tool response).
- **`outgoing`** — a sent message, aligned right (e.g. a request you made).

Each variant aligns to its side, squares off the near-bottom "tail" corner, and tints from a per-theme CSS variable so the bubbles stay coherent across every theme (light / dark / high-contrast). The component is host-agnostic: it ships no copy and no width — the host owns sizing (`max-width`, `width`, …) via `className` / `style`, and the bubble content is whatever children you pass.

## Installation

```typescript
import { ChatBubble } from 'electron-core-ui/renderer'
```

## Component

### ChatBubble

#### Props

```typescript
export type ChatBubbleVariant = 'incoming' | 'outgoing'

export interface ChatBubbleProps {
  /** Incoming (left) vs outgoing (right). Drives alignment + tint. */
  variant: ChatBubbleVariant
  /** Bubble content. */
  children?: React.ReactNode
  /** Optional className appended to the bubble root. */
  className?: string
  /** Optional inline style overrides on the bubble root. */
  style?: React.CSSProperties
  /** Forwarded contextmenu handler (e.g. host "copy" menus). */
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  /** Optional test id applied to the bubble root. */
  'data-testid'?: string
}
```

#### Usage

```tsx
import { ChatBubble } from 'electron-core-ui/renderer'

// In a flex column conversation container:
<ChatBubble variant="outgoing" style={{ maxWidth: '85%' }}>Hi there</ChatBubble>
<ChatBubble variant="incoming" style={{ width: 'calc(100% - 100px)' }}>Hello!</ChatBubble>
```

The host's conversation container should be a flex column (the bubble uses `align-self` to push itself to its side).

## Theming

Each variant's background comes from a theme variable:

- `incoming` → `--chat-bubble-incoming-background`
- `outgoing` → `--chat-bubble-outgoing-background`

These are defined as universal defaults in `resources/themes/base.yaml` and overridden per theme family in `resources/themes/{dark,light,hc_dark,hc_light}/_base.yaml`, so every shipped theme gets an appropriate tint via the normal theme cascade (base → family → specific theme). A specific theme can still override them in its own YAML if it needs a distinct tint. The CSS also carries inline fallbacks so the bubble stays readable even before a theme defines the vars.

## Testing

Pass `data-testid` to target the root (`[data-testid="..."]`). The root also carries `data-variant="incoming|outgoing"`. Class hooks: `.ecu-chat-bubble` (root) plus `.ecu-chat-bubble-incoming` / `.ecu-chat-bubble-outgoing`.
