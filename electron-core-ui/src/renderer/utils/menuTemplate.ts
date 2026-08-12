import React from 'react'

/**
 * A serializable menu node, shaped for Electron's `Menu.buildFromTemplate`.
 *
 * Deliberately free of functions: this crosses the IPC boundary to the main
 * process, which cannot receive a renderer callback. Each actionable item
 * carries an `id`; the main process echoes that id back when the item is
 * chosen and the renderer invokes the original `onClick` from its own map.
 */
export interface NativeMenuNode {
  id?: string
  label?: string
  type?: 'separator'
  accelerator?: string
  enabled?: boolean
  checked?: boolean
  /**
   * Native platform role, declared by the host on its `MenuItem`. Carried
   * through the template so the main process never has to infer intent from
   * an item's test id — the library would otherwise have to know one host
   * app's identifiers, and a rename there would silently drop the role.
   */
  role?: string
  submenu?: NativeMenuNode[]
}

export interface NativeMenuTemplate {
  /** Serializable template, safe to send over IPC. */
  template: NativeMenuNode[]
  /** id → renderer-side handler, kept on this side of the bridge. */
  handlers: Map<string, () => void>
}

/**
 * Translate an ECUI `shortcut` string into an Electron accelerator.
 *
 * `Ctrl+…` becomes `CmdOrCtrl+…` so macOS renders and binds ⌘ while
 * Windows/Linux keep Ctrl — which is exactly the Ctrl-vs-Cmd expectation for
 * a native menu, with no per-platform strings to maintain.
 */
export const toAccelerator = (shortcut?: string): string | undefined => {
  const value = shortcut?.trim()
  if (!value) return undefined
  return value.replace(/\bctrl\b/gi, 'CmdOrCtrl')
}

/** Props carry `unknown`; only real strings become labels. */
const asLabel = (value: unknown): string => (typeof value === 'string' ? value : '')

const displayNameOf = (element: React.ReactElement): string | undefined => {
  const type = element.type as { displayName?: string; name?: string } | string
  if (typeof type === 'string') return undefined
  return type.displayName ?? type.name
}

/**
 * Walk an ECUI MenuBar JSX tree and derive an Electron menu template.
 *
 * The JSX stays the single source of truth: the same elements that render the
 * in-window MenuBar on Windows/Linux describe the native menu on macOS, so
 * labels, shortcuts, order and conditional entries can never drift apart.
 *
 * React elements are plain objects, so this reads `props` directly without
 * rendering. `React.Children.toArray` flattens fragments and drops
 * `false`/`null`/`undefined`, which is what makes conditional entries — e.g.
 * `{fileName && <><MenuItemSeparator/><MenuItem …/></>}` — work unchanged.
 *
 * Unknown element types are traversed through rather than dropped, so a
 * wrapper component around some items does not silently swallow them.
 *
 * @param node - the MenuBar element (or any subtree of menu elements)
 * @returns the serializable template plus the id → handler map
 */
export const buildNativeMenuTemplate = (node: React.ReactNode): NativeMenuTemplate => {
  const handlers = new Map<string, () => void>()
  let seq = 0

  const walk = (children: React.ReactNode): NativeMenuNode[] => {
    const out: NativeMenuNode[] = []

    for (const child of React.Children.toArray(children)) {
      if (!React.isValidElement(child)) continue
      const props = child.props as Record<string, unknown>
      const name = displayNameOf(child)

      if (name === 'MenuItemSeparator') {
        out.push({ type: 'separator' })
        continue
      }

      if (name === 'MenuBarItem') {
        const submenu = walk(props['children'] as React.ReactNode)
        // A top-level menu with no surviving children (everything was
        // conditionally hidden) would render as a dead title.
        if (submenu.length === 0) continue
        out.push({ label: asLabel(props['title']), submenu })
        continue
      }

      if (name === 'MenuItem') {
        const nested = walk(props['children'] as React.ReactNode)
        const id = (props['data-testid'] as string | undefined) ?? `menu-item-${String(seq++)}`
        const onClick = props['onClick']
        if (typeof onClick === 'function') handlers.set(id, onClick as () => void)

        const label = asLabel(props['title'])
        const item: NativeMenuNode = {
          id,
          // `opensDialog` is a render-time convention in the custom bar; the
          // native menu follows the same platform convention explicitly.
          label: props['opensDialog'] === true ? `${label}…` : label
        }
        const accelerator = toAccelerator(props['shortcut'] as string | undefined)
        if (accelerator) item.accelerator = accelerator
        // The host declares the native role; the library never infers one from
        // an item's identifier, so renaming a test id cannot silently drop it.
        const role = props['role']
        if (typeof role === 'string' && role.length > 0) item.role = role
        if (props['disabled'] === true) item.enabled = false
        if (typeof props['checked'] === 'boolean') item.checked = props['checked']
        if (nested.length > 0) item.submenu = nested
        out.push(item)
        continue
      }

      // MenuBar itself, fragments already flattened, or any wrapper: descend.
      const nested = walk(props['children'] as React.ReactNode)
      out.push(...nested)
    }

    return out
  }

  return { template: walk(node), handlers }
}
