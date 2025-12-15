import React, { useState } from 'react'
import { ScrollableElement } from '../ScrollableElement'
import { Modal } from '../Modal'

export interface Tab {
  id: string
  label: string
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
   * @deprecated Use allowFullscreen property on individual tabs instead.
   * This callback is still called if provided, but the built-in fullscreen modal
   * will also be triggered if the tab has allowFullscreen set to true.
   */
  onTabDoubleClick?: (tabId: string) => void
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onTabDoubleClick
}) => {
  const [internalActiveTab, setInternalActiveTab] = useState(tabs[0]?.id ?? '')
  const [fullscreenTabId, setFullscreenTabId] = useState<string | null>(null)
  const currentActiveTab = activeTabId ?? internalActiveTab

  const handleTabClick = (tabId: string): void => {
    setInternalActiveTab(tabId)
    onTabChange?.(tabId)
  }

  const handleCloseClick = (e: React.MouseEvent, tabId: string): void => {
    e.stopPropagation()
    onTabClose?.(tabId)
  }

  const handleTabDoubleClick = (tabId: string, tab: Tab): void => {
    // Call legacy callback if provided
    onTabDoubleClick?.(tabId)
    // Open fullscreen modal if allowed
    if (tab.allowFullscreen) {
      setFullscreenTabId(tabId)
    }
  }

  const activeTab = tabs.find(tab => tab.id === currentActiveTab)
  const useScrollable = activeTab?.useScrollableElement ?? true
  const fullscreenTab = fullscreenTabId ? tabs.find(tab => tab.id === fullscreenTabId) : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%'
      }}
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
            borderBottom: '1px solid var(--vscode-tab-border)',
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
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => {
                  handleTabClick(tab.id)
                }}
                onDoubleClick={() => {
                  handleTabDoubleClick(tab.id, tab)
                }}
                style={{
                  position: 'relative',
                  outline: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '0 12px',
                  height: '35px',
                  fontSize: '13px',
                  fontFamily: 'var(--vscode-font-family)',
                  backgroundColor: 'transparent',
                  color: isActive
                    ? 'var(--vscode-tab-active-text-color)'
                    : 'var(--vscode-tab-inactiveForeground)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  transition: 'color 0.05s ease'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--vscode-tab-active-text-color)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--vscode-tab-inactiveForeground)'
                  }
                }}
              >
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '2px',
                      backgroundColor: 'var(--vscode-tab-activeBorder)',
                      zIndex: 10
                    }}
                  />
                )}
                <span>{tab.label}</span>
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
                      e.currentTarget.style.backgroundColor = 'var(--vscode-toolbar-hoverBackground)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.7'
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                    aria-label={`Close ${tab.label}`}
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
      <div role="tabpanel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {useScrollable ? (
          <ScrollableElement
            key={currentActiveTab}
            options={{ vertical: 'auto', horizontal: 'auto', useShadows: true }}
            style={{
              flex: 1,
              backgroundColor: 'var(--vscode-editor-background)',
              minHeight: 0
            }}
          >
            {activeTab?.content}
          </ScrollableElement>
        ) : (
          <div
            style={{
              flex: 1,
              backgroundColor: 'var(--vscode-editor-background)',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {activeTab?.content}
          </div>
        )}
      </div>
      <Modal
        isOpen={fullscreenTabId !== null}
        onClose={() => {
          setFullscreenTabId(null)
        }}
        title={fullscreenTab?.fullscreenModalTitle ?? fullscreenTab?.label ?? ''}
      >
        {fullscreenTab?.content}
      </Modal>
    </div>
  )
}

export default Tabs
