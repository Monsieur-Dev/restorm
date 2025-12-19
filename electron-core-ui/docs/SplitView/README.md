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

## Behavior

- **Orientation**
  - `orientation="vertical"`: panes are laid out side-by-side with vertical `Sash` handles.
  - `orientation="horizontal"`: panes are stacked with horizontal `Sash` handles.
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
