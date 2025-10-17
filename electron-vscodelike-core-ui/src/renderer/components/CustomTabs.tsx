import React, { useState } from 'react'

export interface Tab {
  id: string
  label: string
  content: React.ReactNode
  closable?: boolean
}

interface CustomTabsProps {
  tabs: Tab[]
  activeTabId?: string
  onTabChange?: (tabId: string) => void
  onTabClose?: (tabId: string) => void
}

export const CustomTabs: React.FC<CustomTabsProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%'
      }}
    >
      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          position: 'relative',
          borderBottom: '1px solid var(--vscode-tab-border)',
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
          height: '35px'
        }}
        className="hide-scrollbar"
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
              style={{
                position: 'relative',
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

      {/* Tab content */}
      <div
        role="tabpanel"
        style={{
          flex: 1,
          overflow: 'auto',
          backgroundColor: 'var(--vscode-editor-background)',
          padding: '16px'
        }}
      >
        {activeTab?.content}
      </div>
    </div>
  )
}

export default CustomTabs

