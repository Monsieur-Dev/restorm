# SplitView Component

## Overview

`SplitView` is a declarative wrapper around split layouts with draggable `Sash` separators.  
It lets you arrange multiple panes either horizontally or vertically while keeping the look & feel driven by theme variables.

## Basic usage

```tsx
import React from 'react';
import { SplitView, Pane } from 'electron-core-ui/renderer';

const Example: React.FC = () => {
  return (
    <div style={{ width: '100%', height: '400px' }}>
      <SplitView orientation="vertical">
        <Pane title="Left">
          <div>Left content</div>
        </Pane>
        <Pane title="Right">
          <div>Right content</div>
        </Pane>
      </SplitView>
    </div>
  );
};
```

## API

### `SplitView`

```ts
export type SplitViewOrientation = 'vertical' | 'horizontal';

export interface SplitViewProps {
  orientation?: SplitViewOrientation; // default: 'vertical'
  className?: string;
  style?: React.CSSProperties;
  /**
   * Optional test id for the SplitView root.
   */
  'data-testid'?: string;
  /**
   * Called whenever pane size ratios change after a drag.
   * Ratios are normalized and always sum to 1.
   */
  onSizesChange?: (sizes: number[]) => void;
  children?: React.ReactNode; // one or more <Pane> children
}
```

### `Pane`

```ts
export interface SplitViewPaneProps {
  id?: string;
  title?: React.ReactNode;
  /**
   * Optional actions area rendered on the right side of the header.
   * Either a ReactNode or a render function receiving `{ collapsed, toggle }`.
   * Hidden by default, revealed on pane hover — see `alwaysShowHeaderActions`
   * to opt out of that behavior.
   */
  headerActions?: React.ReactNode | ((ctx: { collapsed: boolean; toggle: () => void }) => React.ReactNode);
  /**
   * Force the header actions to stay visible instead of the default
   * hover-reveal. Useful when the only way to add a row to a pane is
   * that action button and the user would never hover to discover it.
   * Defaults to false.
   */
  alwaysShowHeaderActions?: boolean;
  /**
   * Whether this pane can be collapsed from its header. Defaults to true.
   */
  collapsible?: boolean;
  /**
   * Initial collapsed state when the SplitView mounts.
   */
  defaultCollapsed?: boolean;
  /**
   * Optional controlled collapsed state. When provided, it will be used
   * as the initial collapsed value for this pane (for now). Defaults to false.
   */
  collapsed?: boolean;
  /**
   * Minimum size in pixels for this pane.
   */
  minSize?: number;
  /**
   * Maximum size in pixels for this pane.
   */
  maxSize?: number;
  /**
   * Initial relative size (0–1) before user resizes.
   * When omitted, remaining space is distributed equally.
   */
  initialSize?: number;
  children?: React.ReactNode;
}
```

> `Pane` is declarative only: it does not render DOM itself, `SplitView` inspects its children and builds the layout.

**Header actions visibility** — by default, the `headerActions` area fades in only while the user hovers the pane. Set `alwaysShowHeaderActions` to `true` when the action is the sole affordance for a common task (e.g. a "+" that adds a row to the body) and hover-reveal would hide it from discovery.

## Behavior

- **Orientation**
  - Current implementation renders a vertical stack (top/bottom panes) using a horizontal `Sash`.
  - `orientation` is currently used as a CSS class name and does not change the layout direction.
- **Resizing**
  - Dragging a `Sash` updates neighboring pane ratios while respecting `minSize` / `maxSize` when provided.
  - The `onSizesChange` callback receives updated ratios so parents can react (e.g. persist layout).
- **Theming**
  - Uses the existing `Sash` component and theme variables, including:
    - `--sash-size`
    - `--sash-hover-size`
    - `--sash-hoverBorder`
    - `--panel-border`
    - `--editorGroup-border`
    - `--sideBar-background`

The main container uses the `monaco-split-view2` class name to stay close to theme’s DOM structure.

## Testing

### `data-testid` API

`SplitView` exposes stable E2E hooks via `data-testid` (default: `split-view`).
When `data-testid="my-split"` is provided:

- Root: `my-split`
  - attributes:
    - `data-pane-count`: number
    - `data-collapsed`: `true|false|...` (one per pane)
    - `data-sizes`: `n|n|...` (integer percentages, sum to 100)
- Pane container: `my-split-pane-{paneIdOrIndex}` (attribute `data-pane-id`)
  - header: `my-split-pane-{paneIdOrIndex}-header` (attribute `data-is-collapsed`)
  - body: `my-split-pane-{paneIdOrIndex}-body`
- Internal sashes: `my-split-sash-{index}` (between pane index `index` and `index + 1`)

### Selectors (electron-core-ui/testing)

- `splitViewRootSelector(testId)`
- `splitViewPaneTestId(testId, paneIdOrIndex)`
- `splitViewPaneSelector(testId, paneIdOrIndex)`
- `splitViewPaneHeaderSelector(testId, paneIdOrIndex)`
- `splitViewPaneBodySelector(testId, paneIdOrIndex)`
- `splitViewSashTestId(testId, index)`
- `splitViewSashSelector(testId, index)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineSplitViewBddSteps(bdd)`
- `defineSashBddSteps(bdd)` (to drag internal sashes)

Steps:

- `Then split view {string} should be visible`
- `Then split view {string} pane count should be {int}`
- `Then split view {string} collapsed state should be {string}`
- `Then split view {string} sizes should be {string}`
- `Then split view {string} sizes should sum to {int}`
- `When I toggle split view {string} pane {string}`
