# The `.restorm` file association

Double-clicking a `.restorm` file opens it in Restorm. This note records how
that is wired per platform, and where it deliberately stops.

## Declaring the type

One `fileAssociations` entry in the `build` key of `restorm/package.json` is
the single source: extension `restorm`, MIME type `application/x-restorm`,
role `Editor` with rank `Owner` (Restorm edits the format, and no other tool
claims it). electron-builder expands that entry into the per-target
registration — Windows registry keys and a ProgID, macOS
`CFBundleDocumentTypes`, and the Linux desktop entry's `MimeType=`.

The document icon is the application icon. A distinct `.restorm` document
mark is a design task in its own right; until it exists, showing the app's
own mark is better than the desktop's generic "unknown file" square.

## How the path reaches the app

The OS does **not** use Restorm's `--open` flag. Three channels deliver a
document, and all three converge on one router in `src/main/index.ts`:

| Platform | Cold start | Already running |
| --- | --- | --- |
| Windows / Linux | path as a bare positional in `process.argv` | `second-instance` event carrying the launched process's argv |
| macOS | `app.on('open-file')`, fired **before** `whenReady` | `app.on('open-file')` |

`findProjectFileInArgv` (`src/main/fileAssociation.ts`) does the recognition
for the argv channels. It skips anything starting with `-`, so an option
value can never be mistaken for a document, and it never touches the
filesystem — a path that turns out not to exist is the open path's problem
to report, not a reason to silently ignore what the user double-clicked.

The macOS cold start is the case worth knowing about: the `open-file` event
that *launched* the app arrives long before there is a window to show it in.
That path is buffered and drained once the window exists. Without the drain,
the double-click that started Restorm would open nothing.

The single-instance lock funnels every OS-launched handler into the running
instance, which is brought forward and opens the document. Restorm also
supports several concurrent instances (the MCP `create_instance` tool), and
a spawned instance with no document in its argv deliberately keeps running
without the lock. Working out *which* of several instances already owns a
given file, and foregrounding that one specifically, is richer routing that
is not implemented here.

## Linux packaging

`build/postinstall.sh` (deb/rpm only) does three things beyond what
electron-builder generates:

1. Rewrites the desktop entry's `Exec=` to `/usr/bin/restorm %f`. The
   wrapper is needed anyway for the sandbox flags, and `%f` is the field
   code that makes the entry accept a document — without it the desktop
   database treats Restorm as taking no argument and a double-click opens
   an empty app. The wrapper forwards `"$@"`, so the path survives the hop.
2. Installs a shared-MIME-info XML declaring `application/x-restorm` with a
   `*.restorm` glob. `MimeType=` on the desktop entry is not enough on its
   own: until the type exists in the MIME database, a file manager treats
   `.restorm` as plain text and the association never fires.
3. Copies the application icon into the `mimetypes` icon directories so the
   file type has a visual.

`build/postremove.sh` reverses all three and refreshes the caches.

### AppImage is not covered

**File association does not work for AppImage users.** The AppImage runs no
install step — `postinstall.sh` never executes for it — so nothing registers
the MIME type, the icon, or a desktop entry pointing at the AppImage's own
path. Wiring it up would mean first-run desktop integration (writing into
`~/.local/share/{applications,mime,icons}` from inside the app), which is a
separate piece of work with its own questions about opting in, updating, and
uninstalling.

Users who want double-click to open should install the `.deb` or `.rpm`.

## Verifying a change

The association itself cannot be exercised headlessly: it needs a packaged
build and a real file manager on each OS. What *is* covered automatically is
the recognition half — `src/main/fileAssociation.test.ts` pins the argv
parsing, including the cases that would silently break it (flags, a bare
`.restorm` with no basename, a deep-link URL).

Everything else is manual, per OS, on a packaged artifact: install, confirm
the file type shows Restorm's icon, double-click a `.restorm` with the app
closed, then again with it already running.
