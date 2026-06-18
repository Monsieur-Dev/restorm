# SplashWindow

A generic splash screen for the boot sequence: a small, centered, frameless,
always-on-top window that appears immediately while the app initializes, then
hands off to the main window once it is fully ready to paint — with no flash of
an unstyled or half-loaded window.

The library owns the **window + the mechanics** (size, centering, frameless,
transparency, whole-surface drag, always-on-top, the show-main-only-when-ready
rule). The application owns only the **content** — its logo.

## Quick start

Opt in through `initializeApp` (the boot orchestrator). Pass a `splash` with
your logo, and create the main window with `showWhenReady: true` so it stays
hidden until its renderer is ready:

```ts
import { initializeApp } from 'electron-core-ui/main'
import { join } from 'path'
import { MyMainWindow } from './windows/MyMainWindow'

initializeApp('my-app', {
  createWindow: () => new MyMainWindow(), // returns the BaseWindow instance
  rendererPath: join(__dirname, '../renderer'),
  splash: {
    logoPath: join(__dirname, '../../assets/imgs/logo.png'),
    background: '#1a1a2e'
  }
})
```

```ts
// MyMainWindow.ts — create the main window hidden, revealed when ready.
const configuration = {
  name: 'main',
  defaultWidth: 1200,
  defaultHeight: 800,
  url: process.env['ELECTRON_RENDERER_URL'],
  file: join(__dirname, '../renderer/index.html'),
  showWhenReady: true // create hidden, reveal on the renderer-ready signal
}
```

The renderer must signal when its real UI is **fully mounted** so the splash
hands off at the right moment. Call `window.electronAPI.notifyReady()` from the
real app's first mount — after any lazy/Suspense root has resolved and i18n is
ready, so the loading fallback is already gone:

```tsx
// inside your top-level App component (the one rendered by Suspense)
useEffect(() => {
  window.electronAPI?.notifyReady?.()
}, [])
```

The boot sequence then becomes:

1. `app.whenReady` → the splash is created and shown (before the main window exists).
2. Services + IPC + the app protocol are wired.
3. `createWindow()` creates the main window **hidden** (`showWhenReady`).
4. The renderer mounts its real UI and calls `notifyReady()` → `app:renderer-ready`.
5. The splash is closed, then the main window is shown — a clean, flash-free handoff.

> **Why not `ready-to-show`?** Electron's `ready-to-show` fires on the window's
> FIRST paint, which for a Suspense / lazy-loaded app is the loading fallback —
> revealing the window then would show the loader the splash is meant to hide.
> The explicit `notifyReady()` signal fires only once the real UI is painted, so
> the user never sees an intermediate loading state.

## How `createWindow` should return its window

`initializeApp`'s `createWindow` may return the `BaseWindow` instance it
created. When it does, the splash handoff hooks that window's precise readiness
callback (`onReadyToShow`, driven by the renderer-ready signal). When it returns
nothing, the library falls back to the first window's `ready-to-show` event.
Returning the instance is preferred.

```ts
createWindow: () => {
  const win = new MyMainWindow()
  // …app-specific wiring on win.getWindow()…
  return win // let the splash close exactly when this window is ready
}
```

## Standalone use

You can also drive the splash yourself with `createSplashWindow`, e.g. to show
a splash outside the `initializeApp` flow:

```ts
import { createSplashWindow } from 'electron-core-ui/main'

const splash = createSplashWindow({ logoPath: '/abs/logo.png' })
// …later, right before showing your window…
splash.close()
```

## API

### `initializeApp(appName, options)`

The object form of `initializeApp` accepts `InitializeAppOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `createWindow` | `() => BaseWindow \| undefined` | — | Creates the main window. Return the instance to get a precise splash handoff. |
| `splash` | `SplashWindowOptions` | — | When set, shows a splash and defers the main window until ready. |
| `devResourcesPath` | `string` | — | Resources dir in development. |
| `rendererPath` | `string` | — | Renderer dir for the `app://` protocol. |
| `onActivate` | `() => void` | — | macOS `activate` handler. |
| `appSettingsConfigPath` | `string` | — | App-specific settings YAML. |
| `appFeaturesConfigPath` | `string` | — | App-specific features YAML. |

> The legacy positional form
> `initializeApp(appName, createWindow, devResourcesPath, onActivate, rendererPath, settings, features)`
> still works — pass the object form to opt into the splash.

### `createSplashWindow(options): SplashWindowHandle`

Creates and shows the splash immediately.

`SplashWindowOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `logoPath` | `string` | — | Absolute path to the logo image; read and inlined as a data URL. |
| `logoDataUrl` | `string` | — | The logo as a ready-made data URL. Takes precedence over `logoPath`. |
| `width` | `number` | `800` | Splash width in pixels. |
| `height` | `number` | `350` | Splash height in pixels. |
| `background` | `string` | `'transparent'` | CSS background of the splash surface. A non-transparent value makes the window opaque. |
| `logoMaxWidth` | `number` | `240` | Max width of the logo (keeps aspect ratio). |

`SplashWindowHandle`:

| Member | Type | Description |
| --- | --- | --- |
| `getWindow()` | `BrowserWindow \| null` | The underlying window, or `null` once closed. |
| `close()` | `void` | Closes + destroys the splash. Idempotent. |

### `window.electronAPI.notifyReady()`

Exposed by the library's preload. The renderer calls it once, from the real
app's first mount (after the loading fallback is gone), to tell the main process
its UI is fully painted. This is the signal that drives the `showWhenReady`
reveal + splash close.

### `BaseWindow` — `showWhenReady`

Set `showWhenReady: true` in a window's `WindowConfiguration` to create it
hidden (`show: false`) and reveal it only when the renderer signals it is fully
mounted (the `app:renderer-ready` IPC fired by `notifyReady()`), NOT on
`ready-to-show` (which fires too early, on the loading fallback's first paint).
Register a callback for that moment with `baseWindow.onReadyToShow(cb)` — it runs
just before the window is shown (and immediately if the window is already past
readiness). When `showWhenReady` is off, `onReadyToShow` fires once on the
renderer's `did-finish-load`, so consumers get a single readiness signal either
way.

## Notes

- The **entire splash surface is draggable** (`-webkit-app-region: drag` in the
  splash HTML), so the user can move it by grabbing anywhere.
- The splash is rendered from self-contained HTML loaded via a `data:` URL — no
  asset server, identical in dev and packaged builds. The only app-specific
  input is the logo.
- The splash is `skipTaskbar` and not resizable / minimizable / maximizable, so
  it behaves like a true boot splash rather than a regular window.
