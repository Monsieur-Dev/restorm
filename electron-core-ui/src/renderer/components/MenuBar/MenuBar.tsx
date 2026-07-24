import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import './menubar.css'
import MenuBarItem from './MenuBarItem'
import MenuItem from './MenuItem'
import { MenuBarProps, MenuBarState, MenuBarLayoutMode } from './types'
import { computeMenuBarLayout } from './computeMenuBarLayout'
import { listMenuItems, focusSiblingMenuItem } from './focusSiblingMenuItem'

/** Default container-width threshold below which the bar fully
 * collapses into a single hamburger button. */
const HAMBURGER_BELOW_PX = 200

/** Estimated width reserved for the overflow / hamburger button when
 * computing how many items fit alongside it. The actual rendered
 * button width is measured after first paint and replaces this
 * estimate so subsequent recomputations are exact. */
const OVERFLOW_BUTTON_FALLBACK_WIDTH = 40

// Wrapper component to avoid ref mutation in render
const MenuItemWrapper: React.FC<{
  child: React.ReactElement
  index: number
  setRef: (index: number, el: HTMLDivElement | null) => void
  isFocused: boolean
  isActive: boolean
  isTabStop: boolean
  onClick: () => void
  onMouseEnter: () => void
  dataTestId: string
}> = ({ child, index, setRef, isFocused, isActive, isTabStop, onClick, onMouseEnter, dataTestId }) => {
  const refCallback = useCallback((el: HTMLDivElement | null) => {
    setRef(index, el)
  }, [index, setRef])

  const childTestId = (child.props as { 'data-testid'?: unknown })['data-testid']

  return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
    key: index,
    ref: refCallback,
    isFocused,
    isActive,
    isTabStop,
    onClick,
    onMouseEnter,
    ...(childTestId === undefined && { 'data-testid': dataTestId })
  })
}

/**
 * Convert a top-level `<MenuBarItem>` element to a `<MenuItem>` so it
 * can render as a submenu entry inside the overflow / hamburger
 * dropdown. The MenuBarItem's children (already MenuItems +
 * separators) are passed through unchanged — `MenuItem`'s submenu
 * logic handles them exactly the same way.
 */
function menuBarItemToMenuItem(child: React.ReactElement, key: React.Key): React.ReactElement {
  const props = child.props as {
    title?: React.ReactNode
    children?: React.ReactNode
    'data-testid'?: string
  }
  return (
    <MenuItem
      key={key}
      title={typeof props.title === 'string' ? props.title : ''}
      {...(props['data-testid'] ? { 'data-testid': `${props['data-testid']}-overflow` } : {})}
    >
      {props.children}
    </MenuItem>
  )
}

const MenuBar: React.FC<MenuBarProps> = ({
  children,
  className = '',
  id,
  hamburgerBelowPx = HAMBURGER_BELOW_PX,
  'data-testid': dataTestId
}) => {
  const testId = dataTestId ?? 'menubar'
  const [state, setState] = useState<MenuBarState>({
    focusedMenuIndex: null,
    isOpen: false,
    activeMenuIndex: null,
    tabStopIndex: 0
  })

  const menubarRef = useRef<HTMLDivElement>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const menuItemsRef = useRef<(HTMLDivElement | null)[]>([])
  // Set by a keyboard open (ArrowDown/ArrowUp) to say which edge of the
  // about-to-render dropdown should receive focus; consumed and cleared by
  // the effect below once the dropdown is actually in the DOM.
  const pendingItemFocusRef = useRef<'first' | 'last' | null>(null)

  // Container width (from ResizeObserver) and per-item natural widths
  // (measured once from the hidden mirror). Both feed the layout-mode
  // computation; we render the same children into both the visible
  // bar and the mirror so the cache invalidates automatically when
  // the children set changes.
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const [itemWidths, setItemWidths] = useState<number[]>([])
  const [overflowButtonWidth, setOverflowButtonWidth] = useState<number>(OVERFLOW_BUTTON_FALLBACK_WIDTH)
  const overflowButtonRef = useRef<HTMLDivElement | null>(null)

  // Stable callback for setting menu item refs
  const setMenuItemRef = useCallback((index: number, el: HTMLDivElement | null) => {
    menuItemsRef.current[index] = el
  }, [])

  const childArray = useMemo(() => React.Children.toArray(children), [children])

  // Decide the current layout mode via the pure helper so the rules
  // can be exercised in unit tests without a DOM.
  const { mode, visibleCount } = useMemo<{ mode: MenuBarLayoutMode; visibleCount: number }>(
    () => computeMenuBarLayout({ containerWidth, itemWidths, hamburgerBelowPx, overflowButtonWidth }),
    [containerWidth, itemWidths, hamburgerBelowPx, overflowButtonWidth]
  )

  // Measurements are driven by a single ResizeObserver that watches
  // both the menubar container (for mode transitions on window
  // resize) and each mirrored item (so adding / changing children
  // updates the cached widths automatically). Deriving setState from
  // ResizeObserver — instead of from a synchronous useLayoutEffect —
  // keeps the React 19 lint rule against cascading renders happy
  // because ResizeObserver callbacks run in an async microtask, not
  // inside the effect's commit phase.
  const lastWidthsSignatureRef = useRef<string>('')
  useEffect(() => {
    const container = menubarRef.current
    const mirror = measurementRef.current
    if (!container) return undefined
    let raf = 0
    const recompute = (): void => {
      const containerRect = container.getBoundingClientRect()
      setContainerWidth(containerRect.width)
      if (mirror) {
        const widths: number[] = []
        const wrappers = mirror.querySelectorAll<HTMLElement>('[data-mirror-index]')
        wrappers.forEach((wrapper) => {
          widths.push(Math.round(wrapper.getBoundingClientRect().width))
        })
        const signature = widths.join(',')
        if (signature !== lastWidthsSignatureRef.current) {
          lastWidthsSignatureRef.current = signature
          setItemWidths(widths)
        }
      }
    }
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(recompute)
    })
    ro.observe(container)
    if (mirror) {
      // Observing the mirror catches children-set changes (the mirror
      // re-renders → its size changes) without an extra effect.
      ro.observe(mirror)
    }
    // Seed with the initial widths so the first paint already knows
    // the layout. The MenuBar renders in `full` mode while measurements
    // are pending; calling `recompute` synchronously here means we
    // skip that intermediate state when the bar starts narrow.
    recompute()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [childArray])

  // Track the overflow / hamburger button's actual rendered width so
  // the budget computation is exact after first paint instead of
  // relying on the fallback estimate.
  useLayoutEffect(() => {
    if (mode === 'full') return
    const el = overflowButtonRef.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    if (w > 0 && Math.abs(w - overflowButtonWidth) >= 0.5) {
      setOverflowButtonWidth(w)
    }
  }, [mode, visibleCount, overflowButtonWidth])

  // The visible set drives keyboard navigation: it's the original
  // children clipped to `visibleCount`, then the overflow / hamburger
  // button as a final entry when present.
  const visibleSetLength = useMemo(() => {
    if (mode === 'full') return childArray.length
    if (mode === 'hamburger') return 1
    return visibleCount + 1
  }, [mode, childArray.length, visibleCount])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const { key } = event

    // No `case 'Tab'` on purpose: with the roving tabindex below, exactly
    // one item ever carries `tabIndex={0}`, so the browser's native Tab
    // handling already does the right thing — it moves focus to the next
    // focusable element *outside* the bar. Intercepting Tab here (an
    // earlier version of this handler did) would trap keyboard focus,
    // cycling forever through the bar's own items instead of letting the
    // user Tab on to the rest of the UI.
    switch (key) {
      // Left/Right always operate at the top level, even when the event
      // bubbled up from deep inside an already-open dropdown — pressing
      // Left/Right jumps to the sibling top-level menu and, if a menu is
      // currently open, swaps it for the sibling's (standard menubar
      // pattern). The `?? prev.tabStopIndex` fallback matters the very
      // first time a key fires after `Tab` alone moved DOM focus onto the
      // roving stop: `focusedMenuIndex` is still `null` at that point, so
      // the press should land ON the already-focused item, not skip past it.
      case 'ArrowLeft':
        event.preventDefault()
        setState(prev => {
          const nextIndex = prev.focusedMenuIndex !== null
            ? Math.max(0, prev.focusedMenuIndex - 1)
            : prev.tabStopIndex
          return {
            ...prev,
            focusedMenuIndex: nextIndex,
            tabStopIndex: nextIndex,
            activeMenuIndex: prev.isOpen ? nextIndex : prev.activeMenuIndex
          }
        })
        break

      case 'ArrowRight':
        event.preventDefault()
        setState(prev => {
          const nextIndex = prev.focusedMenuIndex !== null
            ? Math.min(visibleSetLength - 1, prev.focusedMenuIndex + 1)
            : prev.tabStopIndex
          return {
            ...prev,
            focusedMenuIndex: nextIndex,
            tabStopIndex: nextIndex,
            activeMenuIndex: prev.isOpen ? nextIndex : prev.activeMenuIndex
          }
        })
        break

      // Up/Down are dual-purpose depending on where the event originated:
      // from a top-level button they open the focused menu (Down → first
      // item, Up → last item, mirroring the ARIA menu-button pattern);
      // from inside an already-open dropdown they move between sibling
      // entries instead (roving focus within the open menu).
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        const menuItemAnchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[role="menuitem"]')
        if (menuItemAnchor) {
          focusSiblingMenuItem(menuItemAnchor, key === 'ArrowDown' ? 1 : -1)
          break
        }
        const focusedIndex = state.focusedMenuIndex ?? state.tabStopIndex
        pendingItemFocusRef.current = key === 'ArrowDown' ? 'first' : 'last'
        setState(prev => ({
          ...prev,
          focusedMenuIndex: focusedIndex,
          tabStopIndex: focusedIndex,
          isOpen: true,
          activeMenuIndex: focusedIndex
        }))
        break
      }

      case 'Enter':
      case ' ': {
        event.preventDefault()
        const focusedIndex = state.focusedMenuIndex ?? state.tabStopIndex
        setState(prev => ({
          ...prev,
          focusedMenuIndex: focusedIndex,
          isOpen: true,
          activeMenuIndex: focusedIndex
        }))
        break
      }

      case 'Escape':
        event.preventDefault()
        setState(prev => ({
          focusedMenuIndex: null,
          isOpen: false,
          activeMenuIndex: null,
          tabStopIndex: prev.tabStopIndex
        }))
        break

      default:
        // Handle Alt+key mnemonics. When the matching item is in the
        // overflow / hamburger bucket, open the bucket instead of the
        // hidden item directly — the user follows up with arrow keys
        // / Enter to drill into the matching submenu.
        if (event.altKey && key.length === 1) {
          const matchIndex = childArray.findIndex((child) => {
            if (!React.isValidElement(child)) return false
            const props = child.props as { title?: unknown }
            const title = typeof props.title === 'string' ? props.title : ''
            return title.toLowerCase().includes(key.toLowerCase())
          })

          if (matchIndex !== -1) {
            event.preventDefault()
            // Visible inline → focus + open the original button.
            // Otherwise → focus + open the overflow / hamburger button
            // (the last entry in the visible set).
            const isVisibleInline =
              mode === 'full' || (mode === 'overflow' && matchIndex < visibleCount)
            const targetIndex = isVisibleInline
              ? matchIndex
              : visibleSetLength - 1
            setState({
              focusedMenuIndex: targetIndex,
              isOpen: true,
              activeMenuIndex: targetIndex,
              tabStopIndex: targetIndex
            })
          }
        }
        break
    }
  }, [childArray, state.focusedMenuIndex, state.tabStopIndex, visibleSetLength, mode, visibleCount])

  const handleMenuClick = useCallback((index: number) => {
    setState(prev => ({
      ...prev,
      focusedMenuIndex: index,
      tabStopIndex: index,
      isOpen: !prev.isOpen || prev.activeMenuIndex !== index,
      activeMenuIndex: !prev.isOpen || prev.activeMenuIndex !== index ? index : null
    }))
  }, [])

  const handleMenuMouseEnter = useCallback((index: number) => {
    setState(prev => {
      // Only open on hover if a menu is already open
      if (!prev.isOpen) {
        return prev
      }

      return {
        ...prev,
        focusedMenuIndex: index,
        tabStopIndex: index,
        isOpen: true,
        activeMenuIndex: index
      }
    })
  }, [])

  // Close menu when clicking outside. Listen in the *capture* phase on
  // `pointerdown`: surfaces like a React Flow / graph canvas call
  // `stopPropagation()` (and preventDefault) on pointer events, so a
  // bubble-phase `mousedown` listener never reaches `document` and the
  // open menu would stay stuck. Capture runs before the canvas handler.
  useEffect(() => {
    const handleClickOutside = (event: PointerEvent): void => {
      if (menubarRef.current && !menubarRef.current.contains(event.target as Node)) {
        setState(prev => ({
          focusedMenuIndex: null,
          isOpen: false,
          activeMenuIndex: null,
          tabStopIndex: prev.tabStopIndex
        }))
      }
    }

    if (state.isOpen) {
      document.addEventListener('pointerdown', handleClickOutside, true)
      return () => { document.removeEventListener('pointerdown', handleClickOutside, true) }
    }
    return undefined
  }, [state.isOpen])

  // Focus management
  useEffect(() => {
    if (state.focusedMenuIndex !== null && menuItemsRef.current[state.focusedMenuIndex]) {
      menuItemsRef.current[state.focusedMenuIndex]?.focus()
    }
  }, [state.focusedMenuIndex])

  // Once a keyboard-driven open (see the ArrowDown/ArrowUp/Enter/Space
  // handling above) has actually rendered the dropdown, move focus onto its
  // first or last item as requested. This has to be an effect — the anchor
  // elements don't exist in the DOM until `isOpen`/`activeMenuIndex` commit —
  // and it runs after the "Focus management" effect above so its
  // `.focus()` call (which targets the top-level button) doesn't win.
  useEffect(() => {
    const edge = pendingItemFocusRef.current
    if (!edge || !state.isOpen || state.activeMenuIndex === null) return
    pendingItemFocusRef.current = null
    const trigger = menuItemsRef.current[state.activeMenuIndex]
    const items = listMenuItems(trigger?.querySelector('ul.actions-container[role="menu"]') ?? null)
    const target = edge === 'first' ? items[0] : items[items.length - 1]
    target?.focus()
  }, [state.isOpen, state.activeMenuIndex])

  // Clamp focused / active / tab-stop indices when the visible-set length
  // shrinks (e.g. window narrows from `full` to `overflow` while keyboard
  // focus sat on a now-hidden item). Deferring through rAF moves the
  // setState off the synchronous effect body — the React 19
  // set-state-in-effect rule rejects the synchronous form, even when
  // guarded — and avoids cascading renders. Without this, the
  // focus-management effect above silently no-ops on a stale ref and
  // the focus drifts.
  useEffect(() => {
    const focusOOB = state.focusedMenuIndex !== null && state.focusedMenuIndex >= visibleSetLength
    const activeOOB = state.activeMenuIndex !== null && state.activeMenuIndex >= visibleSetLength
    const tabStopOOB = state.tabStopIndex >= visibleSetLength
    if (!focusOOB && !activeOOB && !tabStopOOB) return undefined
    const collapsedIndex = visibleSetLength > 0 ? visibleSetLength - 1 : null
    const collapsedTabStop = Math.max(0, visibleSetLength - 1)
    const raf = requestAnimationFrame(() => {
      setState(prev => ({
        ...prev,
        focusedMenuIndex: focusOOB ? collapsedIndex : prev.focusedMenuIndex,
        activeMenuIndex: activeOOB ? collapsedIndex : prev.activeMenuIndex,
        tabStopIndex: tabStopOOB ? collapsedTabStop : prev.tabStopIndex
      }))
    })
    return () => { cancelAnimationFrame(raf) }
  }, [visibleSetLength, state.focusedMenuIndex, state.activeMenuIndex, state.tabStopIndex])

  const menubarClasses = [
    'menubar',
    `menubar--mode-${mode}`,
    className
  ].filter(Boolean).join(' ')

  // Build the visible item list according to the current mode.
  let visibleEntries: React.ReactElement[] = []
  if (mode === 'full') {
    visibleEntries = childArray.filter(React.isValidElement)
  } else if (mode === 'overflow') {
    visibleEntries = childArray.filter(React.isValidElement).slice(0, visibleCount)
  }

  // Index of the overflow / hamburger button within the visible set
  // (last position when present, -1 in `full` mode).
  const overflowButtonIndex = mode === 'full' ? -1 : visibleEntries.length

  const overflowChildren = useMemo(() => {
    if (mode === 'full') return null
    const overflowed = mode === 'hamburger'
      ? childArray
      : childArray.slice(visibleCount)
    return overflowed
      .filter(React.isValidElement)
      .map((child, idx) => menuBarItemToMenuItem(child, idx))
  }, [mode, childArray, visibleCount])

  const overflowAriaLabel = mode === 'hamburger' ? 'Application menu' : 'More menu items'
  const overflowIconClass = mode === 'hamburger'
    ? 'codicon codicon-menu'
    : 'codicon codicon-more'
  const overflowDataState = mode === 'hamburger' ? 'hamburger' : 'overflow'

  return (
    <div
      ref={menubarRef}
      id={id}
      className={menubarClasses}
      data-testid={testId}
      data-is-open={state.isOpen ? 'true' : 'false'}
      data-focused-menu-index={state.focusedMenuIndex === null ? '' : String(state.focusedMenuIndex)}
      data-active-menu-index={state.activeMenuIndex === null ? '' : String(state.activeMenuIndex)}
      data-menu-count={String(childArray.length)}
      data-mode={mode}
      data-visible-count={String(visibleEntries.length)}
      role="menubar"
      style={{
        background: 'transparent'
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Hidden mirror used purely for measuring each top-level
          MenuBarItem's natural width. The mirror does NOT render the
          original MenuBarItem subtrees: that would duplicate every
          descendant's `data-testid` and break Playwright locators
          throughout the host app. Instead it renders just the
          button + title shell for each top-level item, which is
          enough to capture the natural width since the title is
          what governs the button's visible footprint. Children
          (MenuItems, separators) are excluded from the mirror, so
          shortcut registration, IDs, and event handlers exist only
          on the visible bar. */}
      <div
        ref={measurementRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          height: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          display: 'flex'
        }}
      >
        {childArray.map((child, index) => {
          const title = React.isValidElement(child)
            ? (child.props as { title?: React.ReactNode }).title
            : null
          return (
            <div
              key={index}
              data-mirror-index={String(index)}
              className="menubar-menu-button"
            >
              <div className="menubar-menu-title">{title}</div>
            </div>
          )
        })}
      </div>

      {visibleEntries.map((child, index) => {
        const isFocused = state.focusedMenuIndex === index
        const isActive = state.activeMenuIndex === index
        const childTestId = `${testId}-menu-${index}`

        return (
          <MenuItemWrapper
            key={index}
            child={child}
            index={index}
            setRef={setMenuItemRef}
            isFocused={isFocused}
            isActive={isActive}
            isTabStop={state.tabStopIndex === index}
            onClick={(): void => { handleMenuClick(index) }}
            onMouseEnter={(): void => { handleMenuMouseEnter(index) }}
            dataTestId={childTestId}
          />
        )
      })}

      {mode !== 'full' && overflowChildren && (
        <MenuBarItem
          ref={(el) => {
            overflowButtonRef.current = el
            setMenuItemRef(overflowButtonIndex, el)
          }}
          title={<i className={overflowIconClass} aria-hidden="true" />}
          aria-label={overflowAriaLabel}
          data-testid={`${testId}-${overflowDataState}-button`}
          isFocused={state.focusedMenuIndex === overflowButtonIndex}
          isActive={state.activeMenuIndex === overflowButtonIndex}
          isTabStop={state.tabStopIndex === overflowButtonIndex}
          onClick={(): void => { handleMenuClick(overflowButtonIndex) }}
          onMouseEnter={(): void => { handleMenuMouseEnter(overflowButtonIndex) }}
        >
          {overflowChildren}
        </MenuBarItem>
      )}
    </div>
  )
}

// Stable identity for the native-menu template walker, which matches
// nodes by displayName rather than importing the components (avoids a
// renderer import cycle). Also improves React DevTools output.
MenuBar.displayName = 'MenuBar'

export default MenuBar
