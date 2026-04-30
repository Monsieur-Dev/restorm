# CustomWCO Component

## Overview

`CustomWCO` (Window Controls Overlay) renders custom window control buttons (minimize / maximize / close) that mimic the native controls on platforms where native controls are not available (notably Linux with WCO).  
It listens to `window.electronAPI` events to adapt to platform and window state.

## API

### Types

```typescript
export interface CustomWCOProps {
  className?: string
  platform?: string
  'data-testid'?: string
}
```

### Props

- **className** (`string`, optional): Extra CSS classes applied to the root container.
- **platform** (`string`, optional): Platform override (`'linux'`, `'darwin'`, `'win32'`, etc.).  
  When omitted, the component uses `window.electronAPI.onPlatform` to detect the platform.
- **data-testid** (`string`, optional): Stable E2E hook applied to the root element (Linux root or win32/darwin spacer).

## Behavior

- When the **current platform is `linux`**, renders custom window buttons (minimize / maximize-or-restore / close).
- When the **current platform is `win32` or `darwin`**, renders a spacer (`custom-wco-spacer`) to reserve space for native window controls.
- On other platforms, returns `null`.
- Subscribes to:
  - `window.electronAPI.onPlatform((platform: string) => …)` to discover platform.
  - `window.electronAPI.onWindowState((state: string) => …)` to track maximized / restored state.
- Sends window actions through:
  - `window.electronAPI.sendAction('minimize' | 'maximize' | 'close')`.
- Visuals are provided by `custom-wco.css` and use Codicons (`codicon-chrome-*`).

### DOM topology (Linux)

The root `.custom-wco` element stays mounted in the host title-bar layout and only acts as a placeholder reserving the controls' grid width. The actual `.window-controls-container` holding the three buttons is **portalled to `document.body`** and pinned via `position: fixed; top: 0; right: 0` with `z-index: 100001`. This is the only way to keep the buttons clickable above a `Modal` overlay — a high `z-index` alone wouldn't escape the host app's stacking context. Test selectors that walk from the root down to the buttons must therefore query `body`-scoped (the `${testId}-{minimize|maximize|close}` testids work either way).

### CSS custom property `--wco-width`

`CustomWCO` writes the rendered controls' width onto `document.body` as `--wco-width` (in pixels):

| Platform   | `--wco-width` value             |
|------------|---------------------------------|
| `linux`    | `92px` (3 × 30px buttons + 2px) |
| `win32`    | OS-reserved width (default `138px`, refined by `navigator.windowControlsOverlay`) |
| `darwin`   | same as `win32`                 |
| other      | `0px`                           |

Downstream consumers (e.g. `Modal`'s `.ecu-modal-drag-strip` `right` offset) read this var so they can leave a matching gap and never swallow WCO clicks. The body-level location guarantees the value is reachable from anywhere in the renderer, including portals. The var is removed on unmount.

## Usage

```tsx
import React from 'react'
import { Titlebar, CustomWCO } from 'electron-core-ui/renderer'

const AppShell: React.FC = ({ children }) => {
  return (
    <Titlebar
      title="Demo"
      rightContent={<CustomWCO />}
    >
      {children}
    </Titlebar>
  )
}
```

## Notes for AI Usage

- Do not use `CustomWCO` on macOS or Windows unless you explicitly want to manage reserved space; on `win32/darwin` it renders a spacer.
- When integrating with a custom preload, ensure that `window.electronAPI.onPlatform`, `onWindowState` and `sendAction` are exposed with the same signatures as in the demo project.
- Keep all user-facing strings (tooltips like `"Minimize"`, `"Restore"`, `"Close"`) consistent and, if needed, route them through the host app’s i18n system instead of inlining translations in this component.

## Testing

### Recommended stable hooks

If you pass a `data-testid` to the component:

- Linux root: `[data-testid="..."]` (element has `.custom-wco`)
- Spacer (win32/darwin): `[data-testid="..."]` (element has `.custom-wco-spacer`)

On Linux, button sub-elements are tagged when `data-testid` is provided:

- Minimize: `${testId}-minimize`
- Maximize/Restore: `${testId}-maximize`
- Close: `${testId}-close`

### E2E helpers

`electron-core-ui/testing` exports selector helpers:

- `customWcoRootSelector(testId)`
- `customWcoSpacerSelector(testId)`
- `customWcoMinimizeSelector(testId)`
- `customWcoMaximizeSelector(testId)`
- `customWcoCloseSelector(testId)`
- `customWcoMaximizeIconSelector(testId, 'chrome-maximize' | 'chrome-restore')`

### Playwright-BDD steps

`electron-core-ui/testing/playwright-bdd` exports `defineCustomWcoBddSteps(bdd)`.
It registers generic steps such as:

- `Then custom wco {string} should be visible`
- `Then custom wco {string} maximize icon should be {string}`
- `When I click custom wco {string} close`
