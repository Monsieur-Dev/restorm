import React, { useState } from 'react'
import { ScrollableElement } from '../ScrollableElement'

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
}

export interface TabsProps {
  tabs: Tab[]
  activeTabId?: string
  onTabChange?: (tabId: string) => void
  onTabClose?: (tabId: string) => void
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
  const currentActiveTab = activeTabId ?? internalActiveTab

  const handleTabClick = (tabId: string): void => {
    setInternalActiveTab(tabId)
    onTabChange?.(tabId)
  }

  const handleCloseClick = (e: React.MouseEvent, tabId: string): void => {
    e.stopPropagation()
    onTabClose?.(tabId)
  }

  const activeTab = tabs.find(tab => tab.id === currentActiveTab)
  const useScrollable = activeTab?.useScrollableElement ?? true

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
                  if (onTabDoubleClick) {
                    onTabDoubleClick(tab.id)
                  }
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
                    ? 'var(--vscode-tab-active-text-color, #000)'
                    : 'var(--vscode-tab-inactiveForeground, rgba(128, 128, 128, 0.7))',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  transition: 'color 0.05s ease'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--vscode-tab-active-text-color, #000)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--vscode-tab-inactiveForeground, rgba(128, 128, 128, 0.7))'
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
                      backgroundColor: 'var(--vscode-tab-activeBorder, var(--vscode-tab-active-text-color, #000))',
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
                      e.currentTarget.style.backgroundColor = 'var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1))'
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
    </div>
  )
}

export default Tabs


