# CustomWCO Component

## Overview

`CustomWCO` (Window Controls Overlay) renders custom window control buttons (minimize / maximize / close) that mimic VSCode on platforms where native controls are not available (notably Linux with WCO).  
It listens to `window.electronAPI` events to adapt to platform and window state.

## API

### Types

```typescript
export interface CustomWCOProps {
  className?: string
  platform?: string
}
```

### Props

- **className** (`string`, optional): Extra CSS classes applied to the root container.
- **platform** (`string`, optional): Platform override (`'linux'`, `'darwin'`, `'win32'`, etc.).  
  When omitted, the component uses `window.electronAPI.onPlatform` to detect the platform.

## Behavior

- Only renders controls when the **current platform is `linux`**; returns `null` otherwise.
- Subscribes to:
  - `window.electronAPI.onPlatform((platform: string) => …)` to discover platform.
  - `window.electronAPI.onWindowState((state: string) => …)` to track maximized / restored state.
- Sends window actions through:
  - `window.electronAPI.sendAction('minimize' | 'maximize' | 'close')`.
- Visuals are provided by `custom-wco.css` and use Codicons (`codicon-chrome-*`).

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

- Do not use `CustomWCO` on macOS or Windows unless you explicitly want to **replace** native window buttons; by default it hides itself on non-Linux platforms.
- When integrating with a custom preload, ensure that `window.electronAPI.onPlatform`, `onWindowState` and `sendAction` are exposed with the same signatures as in the demo project.
- Keep all user-facing strings (tooltips like `"Minimize"`, `"Restore"`, `"Close"`) consistent and, if needed, route them through the host app’s i18n system instead of inlining translations in this component.


