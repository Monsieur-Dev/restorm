import React, { useCallback, useState } from 'react'
import { ScrollableElement } from '../ScrollableElement'
import { Modal } from '../Modal'

export interface Tab {
  id: string
  label: React.ReactNode
  content: React.ReactNode
  closable?: boolean
  /**
   * When false, the tab content is rendered directly without a ScrollableElement wrapper.
   * Defaults to true.
   */
  useScrollableElement?: boolean
  /**
   * When true, double-clicking on the tab opens a fullscreen modal with the tab content.
   * Defaults to false.
   */
  allowFullscreen?: boolean
  /**
   * Custom title for the fullscreen modal. If not provided, the tab label will be used.
   */
  fullscreenModalTitle?: React.ReactNode
}

export interface TabsProps {
  tabs: Tab[]
  activeTabId?: string
  onTabChange?: (tabId: string) => void
  onTabClose?: (tabId: string) => void
  /**
   * When true, all tab contents stay mounted (hidden with CSS) instead of being unmounted.
   * This preserves component state when switching tabs (useful for editors like Milkdown).
   * Requires the parent container to have a defined height.
   * Defaults to false.
   *
   * Superseded by `mountStrategy`. If `mountStrategy` is set, this prop is ignored;
   * otherwise `keepMounted: true` maps to `'eager'` and `keepMounted: false` (the
   * default) maps to `'active-only'`.
   */
  keepMounted?: boolean
  /**
   * Controls when each tab's content is mounted into the React tree:
   *  - `'active-only'` (default when `keepMounted` is false / unset): only the
   *    active tab is mounted; switching unmounts the previous tab and remounts
   *    the new one. Cheapest first render, but tab state is lost on every switch.
   *  - `'eager'` (default when `keepMounted` is true): every tab is mounted up
   *    front and inactive ones are hidden via `visibility:hidden`. State is
   *    preserved across switches at the cost of a heavier cold start — every
   *    tab pays its mount cost before the user has even visited it.
   *  - `'lazy-once'`: a tab is mounted the first time it becomes active and
   *    stays mounted thereafter (hidden via `visibility:hidden` when not the
   *    active tab). The active tab is mounted on first render; never-visited
   *    tabs cost nothing. Best of both worlds for views where most users only
   *    ever interact with one or two of the tabs.
   *
   * `mountStrategy` wins over `keepMounted` when both are passed.
   */
  mountStrategy?: 'eager' | 'lazy-once' | 'active-only'
  /**
   * Legacy callback for tab double-click events.
   * Consider using allowFullscreen property on individual tabs instead for fullscreen behavior.
   * This callback is still called if provided, and the built-in fullscreen modal
   * will also be triggered if the tab has allowFullscreen set to true.
   */
  onTabDoubleClick?: (tabId: string) => void
  /** Optional test id applied to the Tabs root element. */
  'data-testid'?: string
}

const TabsInner: React.FC<TabsProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  keepMounted = false,
  mountStrategy,
  onTabDoubleClick: legacyDoubleClickCallback,
  'data-testid': dataTestId
}) => {
  const [internalActiveTab, setInternalActiveTab] = useState(tabs[0]?.id ?? '')
  const [fullscreenTabId, setFullscreenTabId] = useState<string | null>(null)
  const currentActiveTab = activeTabId ?? internalActiveTab

  // Resolve the effective strategy. `mountStrategy` wins; otherwise we map the
  // legacy boolean `keepMounted` to its equivalent (`true` → `'eager'`,
  // `false`/unset → `'active-only'`) so existing callers keep their behaviour.
  const effectiveStrategy: 'eager' | 'lazy-once' | 'active-only' =
    mountStrategy ?? (keepMounted ? 'eager' : 'active-only')

  // For `'lazy-once'`: track which tabs have ever been the active tab. They
  // stay mounted thereafter (visibility-hidden when not active). The initial
  // active tab is mounted from the first render — never-visited tabs cost
  // nothing. The set is intentionally append-only; we never evict, so a
  // visited tab keeps its state for the lifetime of this `Tabs` instance.
  //
  // We extend the set DURING RENDER (gated by a membership check) rather
  // than in a `useEffect`, so the same render that flips a tab's
  // `visibility` to `visible` also commits the new tab to the tree —
  // otherwise the user would see one frame of empty content before the
  // effect fired.
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(
    () => new Set(currentActiveTab ? [currentActiveTab] : [])
  )
  if (effectiveStrategy === 'lazy-once' && currentActiveTab && !mountedTabs.has(currentActiveTab)) {
    setMountedTabs((prev) => {
      if (prev.has(currentActiveTab)) return prev
      const next = new Set(prev)
      next.add(currentActiveTab)
      return next
    })
  }

  const handleTabClick = useCallback((tabId: string): void => {
    setInternalActiveTab(tabId)
    onTabChange?.(tabId)
  }, [onTabChange])

  const handleCloseClick = useCallback((e: React.MouseEvent, tabId: string): void => {
    e.stopPropagation()
    onTabClose?.(tabId)
  }, [onTabClose])

  const handleTabDoubleClick = useCallback((tabId: string, tab: Tab): void => {
    // Call legacy callback if provided
    legacyDoubleClickCallback?.(tabId)
    // Open fullscreen modal if allowed
    if (tab.allowFullscreen) {
      setFullscreenTabId(tabId)
    }
  }, [legacyDoubleClickCallback])

  const handleFullscreenClose = useCallback((): void => {
    setFullscreenTabId(null)
  }, [])

  const fullscreenTab = fullscreenTabId ? tabs.find(tab => tab.id === fullscreenTabId) : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%'
      }}
      {...(dataTestId && {
        'data-testid': dataTestId,
        'data-active-tab-id': currentActiveTab
      })}
    >
      {/* Tab bar with horizontal ScrollableElement */}
      <ScrollableElement
        options={{
          vertical: 'hidden',
          horizontal: 'auto',
          useShadows: false,
          handleMouseWheel: true,
          mouseWheelHorizontal: true
        }}
        style={{
          height: 35,
          flexShrink: 0
        }}
      >
        <div
          role="tablist"
          style={{
            display: 'flex',
            position: 'relative',
            borderBottom: '1px solid var(--tab-border)',
            height: '35px',
            minWidth: '100%'
          }}
        >
          {tabs.map(tab => {
            const isActive = tab.id === currentActiveTab
            return (
              <div
                key={tab.id}
                role="tab"
                data-tab-id={tab.id}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => {
                  handleTabClick(tab.id)
                }}
                onDoubleClick={() => {
                  handleTabDoubleClick(tab.id, tab)
                }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-tab-${tab.id}` })}
                style={{
                  position: 'relative',
                  outline: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '0 12px',
                  height: '35px',
                  fontSize: '13px',
                  fontFamily: 'var(--font-family)',
                  backgroundColor: 'transparent',
                  color: isActive
                    ? 'var(--tab-active-text-color)'
                    : 'var(--tab-inactiveForeground)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  transition: 'color 0.05s ease'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--tab-active-text-color)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--tab-inactiveForeground)'
                  }
                }}
              >
                {/* Glow effect — linear gradient from bottom (solid) to top (transparent) */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '75%',
                    background: 'linear-gradient(to top, var(--tab-activeGlow, rgba(255,255,255,0.1)) -75%, transparent 100%)',
                    opacity: isActive ? 1 : 0,
                    transition: 'opacity 0.5s ease',
                    pointerEvents: 'none',
                    zIndex: 0
                  }}
                />
                {/* Active indicator line — sits above the tab label
                 * (at zIndex 1) but below any layout primitive's
                 * floating overlay (Dock's hover-preview content sits
                 * at zIndex 3). The bar is purely visual chrome at
                 * the bottom edge of the tab; it doesn't need to
                 * outrank panels that legitimately float over the
                 * tab bar. */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '2px',
                    backgroundColor: isActive ? 'var(--tab-activeBorder)' : 'transparent',
                    transition: 'background-color 0.2s ease',
                    zIndex: 2
                  }}
                />
                <span style={{ position: 'relative', zIndex: 1 }}>{tab.label}</span>
                {tab.closable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      handleCloseClick(e, tab.id)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '16px',
                      height: '16px',
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      color: 'currentColor',
                      cursor: 'pointer',
                      opacity: 0.7,
                      borderRadius: '3px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1'
                      e.currentTarget.style.backgroundColor = 'var(--toolbar-hoverBackground)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.7'
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                    aria-label={`Close ${typeof tab.label === 'string' ? tab.label : tab.id}`}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"
                      />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </ScrollableElement>

      {/* Tab content */}
      <div role="tabpanel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, ...(effectiveStrategy !== 'active-only' ? { position: 'relative' } : {}) }}>
        {effectiveStrategy !== 'active-only' ? (
          // Eager: every tab is mounted up front.
          // Lazy-once: a tab is rendered only once it has ever been active
          // (tracked in `mountedTabs`) and stays mounted thereafter.
          // Both strategies hide inactive tabs via `visibility:hidden` so
          // their component state is preserved across switches.
          tabs.map(tab => {
            if (effectiveStrategy === 'lazy-once' && !mountedTabs.has(tab.id)) return null
            const isActive = tab.id === currentActiveTab
            const useScrollable = tab.useScrollableElement ?? true
            return useScrollable ? (
              <ScrollableElement
                key={tab.id}
                options={{ vertical: 'auto', horizontal: 'auto', useShadows: true }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'var(--editor-background)',
                  visibility: isActive ? 'visible' : 'hidden',
                  pointerEvents: isActive ? 'auto' : 'none'
                }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-tabpanel-${tab.id}` })}
              >
                {tab.content}
              </ScrollableElement>
            ) : (
              <div
                key={tab.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'var(--editor-background)',
                  display: 'flex',
                  flexDirection: 'column',
                  visibility: isActive ? 'visible' : 'hidden',
                  pointerEvents: isActive ? 'auto' : 'none'
                }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-tabpanel-${tab.id}` })}
              >
                {tab.content}
              </div>
            )
          })
        ) : (
          // active-only: only render the active tab (unmount inactive ones).
          (() => {
            const activeTab = tabs.find(tab => tab.id === currentActiveTab)
            if (!activeTab) return null
            const useScrollable = activeTab.useScrollableElement ?? true
            return useScrollable ? (
              <ScrollableElement
                key={currentActiveTab}
                options={{ vertical: 'auto', horizontal: 'auto', useShadows: true }}
                style={{
                  flex: 1,
                  backgroundColor: 'var(--editor-background)',
                  minHeight: 0
                }}
              >
                {activeTab.content}
              </ScrollableElement>
            ) : (
              <div
                style={{
                  flex: 1,
                  backgroundColor: 'var(--editor-background)',
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                {activeTab.content}
              </div>
            )
          })()
        )}
      </div>
      <Modal
        isOpen={fullscreenTabId !== null}
        onClose={handleFullscreenClose}
        title={fullscreenTab?.fullscreenModalTitle ?? fullscreenTab?.label ?? ''}
      >
        {fullscreenTab?.content}
      </Modal>
    </div>
  )
}

export const Tabs = React.memo(TabsInner)
Tabs.displayName = 'Tabs'

export default Tabs
