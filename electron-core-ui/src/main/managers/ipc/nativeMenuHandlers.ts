import { app, Menu, ipcMain, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { logger } from '../../services'

/**
 * Serializable menu node as produced by the renderer's JSX walker.
 *
 * Declared here rather than imported: this runs in the main process, which is
 * a separate tsconfig project from the renderer. Keep it in step with
 * `renderer/utils/menuTemplate.ts`'s `NativeMenuNode` — the two describe the
 * same payload crossing the bridge.
 */
interface NativeMenuNode {
  id?: string
  label?: string
  type?: 'separator'
  accelerator?: string
  enabled?: boolean
  checked?: boolean
  role?: string
  submenu?: NativeMenuNode[]
}

/**
 * Roles the library will honour from a host-declared `role` on a menu item.
 *
 * Routing edit operations through an IPC round-trip to a renderer handler does
 * NOT reliably act on the focused element (native fields, Monaco, webviews),
 * and on macOS an app with no Edit-role menu has no working ⌘C/⌘V/⌘Z at all —
 * the well-known Electron trap. Declaring the role lets Chromium perform the
 * edit natively while the JSX stays the single menu definition.
 *
 * This is an allow-list rather than a pass-through: the value crosses an IPC
 * boundary from the renderer, so it is validated against known-safe roles
 * instead of being handed to `Menu.buildFromTemplate` verbatim.
 *
 * Only LEAF roles — ones that perform an action — are allowed. The container
 * roles (`appMenu`, `fileMenu`, `editMenu`, `windowMenu`) are deliberately
 * excluded, because each would break something:
 *  - they substitute Electron's generated submenu for the host's declared one,
 *    so the native menu and the in-window menu would differ BY CONSTRUCTION —
 *    the single failure mode deriving both from one JSX tree exists to prevent;
 *  - the submenu branch below returns before the role branch, so declaring one
 *    on an item WITH children is silently ignored while the same declaration on
 *    a leaf injects a whole generated submenu — same input, opposite outcomes;
 *  - `appMenu` is already prepended unconditionally when the menu is built, so
 *    a host declaring it would get two application menus.
 *
 * `togglefullscreen` is excluded for a different reason: AppKit appends its own
 * "Enter Full Screen" to any menu carrying that selector under a label it
 * doesn't recognise, so a host asking for it would get two fullscreen entries.
 * Hosts toggle the window over the `toggle-fullscreen` channel instead.
 */
const ALLOWED_ROLES = new Set<string>([
  'undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle',
  'delete', 'selectAll', 'reload', 'forceReload', 'toggleDevTools',
  'resetZoom', 'zoomIn', 'zoomOut', 'minimize', 'close', 'quit'
])

const asRole = (value: unknown): MenuItemConstructorOptions['role'] | undefined =>
  typeof value === 'string' && ALLOWED_ROLES.has(value)
    ? (value as MenuItemConstructorOptions['role'])
    : undefined

export const toMenuItems = (nodes: NativeMenuNode[], sender: WebContents): MenuItemConstructorOptions[] =>
  nodes.map((node): MenuItemConstructorOptions => {
    if (node.type === 'separator') return { type: 'separator' }

    const item: MenuItemConstructorOptions = { label: node.label ?? '' }
    if (node.accelerator) item.accelerator = node.accelerator

    if (node.submenu && node.submenu.length > 0) {
      if (node.enabled === false) item.enabled = false
      item.submenu = toMenuItems(node.submenu, sender)
      return item
    }

    // Role items (undo/copy/paste/…): let Chromium own enablement. The role
    // tracks the focused element and selection, so ⌘C/⌘V light up exactly
    // when they apply. The JSX `disabled` flag marks the not-yet-wired
    // in-window menu on Windows/Linux and must NOT be forwarded here, or the
    // native edit shortcuts would be permanently dead — the very trap a
    // native Edit menu exists to avoid.
    const role = asRole(node.role)
    if (role) {
      item.role = role
      return item
    }

    if (node.enabled === false) item.enabled = false
    if (typeof node.checked === 'boolean') {
      item.type = 'checkbox'
      item.checked = node.checked
    }

    if (node.id) {
      const id = node.id
      item.click = (): void => {
        if (!sender.isDestroyed()) sender.send('native-menu:invoke', id)
      }
    }
    return item
  })

/** Validate the optional app-menu About routing crossing the bridge. */
const asAboutRouting = (value: unknown): { id: string; label: string } | null => {
  if (typeof value !== 'object' || value === null) return null
  const { id, label } = value as Record<string, unknown>
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof label !== 'string' || label.length === 0) return null
  return { id, label }
}

/**
 * The application menu (the bold first entry on macOS).
 *
 * With no About routing this stays the plain `appMenu` role — its native About
 * panel and all. When the host routes About to itself, the role is expanded to
 * an explicit menu whose "About" item echoes the host id back (so the host can
 * open its own About surface) while every other entry keeps the platform role,
 * so Services / Hide / ⌘Q behave exactly as the role would provide.
 */
const buildAppMenu = (about: unknown, sender: WebContents): MenuItemConstructorOptions => {
  const routing = asAboutRouting(about)
  if (!routing) return { role: 'appMenu' }
  return {
    label: app.name,
    submenu: [
      {
        label: routing.label,
        click: (): void => { if (!sender.isDestroyed()) sender.send('native-menu:invoke', routing.id) }
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }
}

/**
 * Build the application menu from a renderer-supplied template.
 *
 * The renderer derives the template by walking the same MenuBar JSX it would
 * render in-window, so the two can never drift. Only serializable data
 * crosses the bridge; activating an item sends `native-menu:invoke` back with
 * the item id and the renderer runs its own handler.
 */
export function registerNativeMenuHandlers(): void {
  ipcMain.handle('native-menu:set', (event, template: unknown, about: unknown) => {
      if (!Array.isArray(template)) {
        logger.warn('native-menu:set received a non-array template; ignoring')
        return false
      }
      try {
        const appMenus = toMenuItems(template as NativeMenuNode[], event.sender)
        // macOS expects the application menu first — it carries About/Services/
        // Hide and, importantly, ⌘Q. Without it the app has no Quit item.
        const full: MenuItemConstructorOptions[] = [buildAppMenu(about, event.sender), ...appMenus]
        Menu.setApplicationMenu(Menu.buildFromTemplate(full))
        return true
      } catch (error) {
        logger.error('Failed to build native application menu', { error: String(error) })
        return false
      }
  })

  ipcMain.handle('native-menu:clear', () => {
      Menu.setApplicationMenu(null)
      return true
  })
}
