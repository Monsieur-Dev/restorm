# AppIconMenuService

Main-process service that keeps the **application-icon menu** — the menu the OS
shows on the app's icon itself — in step with the file state: a *new file*
action, the recent files, and the favorites.

macOS Dock, Windows jump lists, and the Linux launcher are the surfaces wired
today, all rendered from the same neutral model — the host needs no platform
branch of its own. Linux has no single live menu, so the model maps onto
freedesktop mechanisms instead (see [Linux](#linux-freedesktop-surfaces)).

```ts
// main process
import { initAppIconMenuService, getAppIconMenuService, getFileService, registerAppIconMenuHandlers } from 'electron-core-ui'

initAppIconMenuService({ fileService: getFileService() })
getAppIconMenuService().start()
registerAppIconMenuHandlers()
```

```tsx
// renderer — push the translated labels, and re-push on a language change
useEffect(() => {
  window.api.appIconMenu.setLabels({
    newFile: t('menuBar.new'),
    recentFiles: t('menuBar.recentFiles'),
    favorites: t('menuBar.favorites')
  })
}, [t, i18n.language])
```

## Why main-driven, with host-injected labels

The two halves of the menu come from opposite ends of the app, and both
directions are deliberate:

- **The entries are built in main.** The application icon is present whenever
  the app is running — including with no window open at all, which on macOS is
  the normal state after closing the last window. A menu derived from renderer
  state would be empty or stale exactly when the user reaches for it, so the
  entries are read from the main-side `FileService`, the source of truth for the
  recent and favorite lists.
- **The labels come from the renderer.** The main-process translator only holds
  the locales its host loaded into it, which is typically a small subset; the
  renderer loads every locale the app ships. Resolving the labels in main would
  therefore show English to any user outside that subset. The host pushes the
  three translated strings over IPC instead, and re-pushes them whenever the UI
  language changes.

Until the host has pushed labels, `buildModel()` returns `null` and the adapter
is **cleared** rather than applied — an untranslated menu is worse than none.

## Behaviour

Entries, in order:

1. **New file** — runs `FileService.newFile()`.
2. **Recent files** — a submenu of `FileService.getRecentFiles()`; each item
   opens its file. **Omitted entirely when the list is empty.**
3. **Favorites** — a submenu of `FileService.getFavorites()`, same shape, same
   omission rule.

The service subscribes to `FileService.onStateChanged` and re-renders on
change. Opening a file emits several state changes in a row, so rebuilds are
debounced (150 ms by default, `rebuildDebounceMs`) into a single render.

### Running an activated action

By default an activation acts straight on the `FileService`. That is right for
a headless host, but a **windowed** host usually wants more: its own *new* and
*open recent* commands guard unsaved work (prompting before the open document
is replaced) and bring a window forward — acting on the file service directly
would bypass all of that and silently discard the user's changes.

So the host may inject a `dispatch`. The recommended shape: when a window is
open, forward the action to it over `APP_ICON_MENU_INVOKE_CHANNEL` and let the
renderer run the same guarded command its in-app menus use; with no window (no
renderer to guard, no in-renderer dirty state to protect), fall back to
`dispatchDirect(action)`, which acts on the file service without looping back
through the injected dispatch.

## API

| Member | Description |
|---|---|
| `initAppIconMenuService(options)` | Create the singleton (disposing any previous one) and return it. |
| `getAppIconMenuService()` | Access the singleton; throws when it was never initialized. |
| `isAppIconMenuServiceInitialized()` | Whether a singleton exists — lets early IPC be ignored rather than throw. |
| `resetAppIconMenuService()` | Dispose and drop the singleton (tests). |
| `start()` | Subscribe to file-state changes and render once. Idempotent. |
| `setLabels(labels)` | Publish the host's translated labels and render immediately. |
| `buildModel()` | The menu as it should currently appear, or `null` while labels are missing. |
| `rebuild()` | Render the current model through the adapter. |
| `dispatch(action)` | Run an action (`new-file`, `open-file`). Uses the injected `dispatch` when present, else acts on the file service. |
| `dispatchDirect(action)` | Act on the file service directly — the no-injected-dispatch behaviour, and the escape hatch an injected dispatch calls for its no-window case. |
| `dispose()` | Unsubscribe, cancel any pending rebuild, clear the rendered menu. |

`AppIconMenuServiceOptions`:

| Option | Type | Description |
|---|---|---|
| `fileService` | `FileService` | Required. Source of the recent + favorite lists and target of the actions. Injected rather than resolved internally, so the service is testable without an Electron app. |
| `adapter` | `AppIconMenuAdapter` | Platform integration. Defaults to `createDefaultAdapter({ linuxDesktopFileId, linuxRecentDocumentMimeType })`. |
| `linuxDesktopFileId` | `string` | The installed `.desktop` file id (e.g. `myapp.desktop`) the Linux integration extends with favorites and reads the launcher `Exec` from. Ignored when `adapter` is given. |
| `linuxRecentDocumentMimeType` | `string` | MIME type stamped on the Linux recent-documents entries, so the launcher ties recents to this app. Ignored when `adapter` is given. |
| `rebuildDebounceMs` | `number` | Coalescing window for file-state driven rebuilds. Defaults to `150`. |
| `dispatch` | `(action: AppIconAction) => void` | How an activated entry is carried out. Defaults to acting on the file service; a windowed host injects its own to route through its guarded flow. |

## IPC

| Channel | Direction | Payload |
|---|---|---|
| `app-icon-menu:set-labels` (`APP_ICON_MENU_SET_LABELS_CHANNEL`) | renderer → main | `AppIconMenuLabels` — `{ newFile, recentFiles, favorites }` |
| `app-icon-menu:invoke` (`APP_ICON_MENU_INVOKE_CHANNEL`) | main → renderer | `AppIconAction` — `{ kind: 'new-file' }` or `{ kind: 'open-file', path }` |

`set-labels` is registered by `registerAppIconMenuHandlers()`, which the
**host** calls after creating the service — unlike the other core handlers, it
is not part of `setupIPC`, because it only makes sense for a host that wants
this menu. The payload is validated field by field: a partial object would
render entries labelled `undefined` rather than fail, so it is rejected and
logged. Labels arriving before the service exists are ignored, not thrown.

`invoke` runs the other way: the host's injected `dispatch` sends the activated
action to the focused window, and the renderer runs it through its guarded file
command. It only fires when the host both injects that dispatch and subscribes.

Preload bridges (`window.api.appIconMenu`):

- `setLabels(labels)` — fire-and-forget; main rebuilds on its own schedule and
  the renderer has nothing to await.
- `onInvoke(cb)` — subscribe to forwarded actions; returns an unsubscribe.

## Adapters

```ts
interface AppIconMenuAdapter {
  apply(model: AppIconMenuModel, dispatch: (action: AppIconAction) => void): void
  clear(): void
}
```

The model is platform-neutral (`AppIconMenuEntry` = `id`, `label`, `enabled`,
optional `action`, optional `submenu`); only the adapter knows Electron's menu
vocabulary. `dispatch` is passed on every `apply` rather than held by the
adapter, so the callback always reaches the service that produced those entries.

| Adapter | Platform | Behaviour |
|---|---|---|
| `MacDockAdapter` | darwin | Builds a template and calls `app.dock.setMenu(...)`; returns early when there is no dock. `clear()` sets an empty menu. |
| `WindowsJumpListAdapter` | win32 | Builds jump-list categories and calls `app.setJumpList(...)`. Top-level actions become the shell's **tasks** category, each submenu a **custom** category named after its label. `clear()` passes `null`. Returns early off Windows, and never lets a rejected list throw. |
| `LinuxRecentDocumentsAdapter` | linux | Writes recents to `~/.local/share/recently-used.xbel` (see [Linux](#linux-freedesktop-surfaces)). |
| `LinuxDesktopActionsAdapter` | linux | Maintains favorites as `.desktop` actions in a user-level override (see [Linux](#linux-freedesktop-surfaces)). |
| `CompositeAppIconMenuAdapter` | — | Fans one model out to several adapters — how Linux drives its two surfaces at once. |
| `NoopAppIconMenuAdapter` | others | No-op both ways. |
| `createDefaultAdapter(options)` | — | Picks by `process.platform`; on linux composes the two adapters above. |

Passing a custom adapter is also how tests observe the rendered model without
an Electron app.

### Relaunch-based adapters and the argv convention

A jump list is not a live menu. Windows hands it to the shell, which **starts
the program again** with the arguments recorded on the chosen item — nothing
calls back into the running process. `WindowsJumpListAdapter` therefore ignores
the `dispatch` callback entirely and serializes each entry's action into launch
arguments against `process.execPath` instead:

| Action | Arguments |
|---|---|
| `{ kind: 'new-file' }` | `--new` |
| `{ kind: 'open-file', path }` | `"<path>"` — quoted, so a name with spaces survives argv splitting |

That is the **one convention a host must honour** for this adapter to work: a
bare file-path positional opens that file, and a `--new` flag starts on a new
file. A host holding a single-instance lock sees both on its `second-instance`
event rather than in a fresh process, and should route them through the same
guarded flow its injected `dispatch` uses. Cold start needs no special case for
`--new` — an app starting from nothing already opens on an empty document.

### Linux (freedesktop surfaces)

Linux desktops (KDE Plasma, GNOME, docks) do not expose a single live app-icon
menu; they read **freedesktop-standard** stores instead. The Unity
`LauncherEntry` dynamic quicklist looks like a fit but KDE ignores its
`dbusmenu` property, so the model is split across two adapters, composed by
`createDefaultAdapter` and driven together:

- **Recents → `LinuxRecentDocumentsAdapter`.** Electron has no Linux
  `app.addRecentDocument`, so this writes `~/.local/share/recently-used.xbel`
  (the XDG recent-documents file `GtkRecentManager` maintains). Each bookmark is
  tagged with a `bookmark:application` whose `exec` is read from the installed
  `.desktop` — the launcher matches on that to group the recents under the app's
  icon, so it must equal the entry's `Exec` (not `process.execPath`, which can
  be an Electron `.bin` wrapper). The file is shared, so writes preserve other
  apps' bookmarks and **merge** our attribution onto entries another writer
  (e.g. the GTK file-chooser portal) already created for our files.
- **"New" and favorites → `.desktop` actions.** "New" is a **static, localized**
  `[Desktop Action]` shipped in the packaged `.desktop` (e.g. via
  electron-builder `linux.desktop.desktopActions`, reusing the `--new` relaunch
  contract). Favorites are dynamic, so `LinuxDesktopActionsAdapter` maintains a
  **user-level `.desktop` override** at `~/.local/share/applications/<id>` that
  shadows the installed entry: it copies the packaged entry, extends `Actions=`,
  and appends a `[Desktop Action]` group per favorite. The override is stamped
  with a marker key so it is only ever removed when it is the one we wrote, and
  it is removed entirely when there are no favorites.

As with the Windows jump list, activation is **relaunch-based** — the launcher
runs the program with the file as an argument — so these adapters ignore
`dispatch` and rely on the same argv convention (`--new`, or a file path). The
host supplies `linuxDesktopFileId` and `linuxRecentDocumentMimeType`; everything
is best-effort and degrades to a no-op (a missing session dir, no installed
entry, an unwritable store) rather than failing the app.
