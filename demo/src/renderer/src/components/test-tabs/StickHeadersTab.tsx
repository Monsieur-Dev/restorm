import React, { useEffect, useState } from 'react'
import { ListView, ListViewItem } from 'electron-core-ui/renderer'

const StickHeadersTab: React.FC = () => {
  const [scrollTop, setScrollTop] = useState(0)
  const [maxScroll, setMaxScroll] = useState(0)

  const getScrollableContent = (): HTMLDivElement | null => {
    const container = document.getElementById('stick-headers-scroll')
    if (!container) {
      return null
    }
    const content = container.querySelector('.scrollable-content')
    return (content instanceof HTMLDivElement) ? content : null
  }

  useEffect(() => {
    const el = getScrollableContent()
    if (!el) {
      return
    }

    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    setScrollTop(el.scrollTop)
    setMaxScroll(max)

    const handleResize = (): void => {
      const target = getScrollableContent()
      if (!target) {
        return
      }
      const nextMax = Math.max(0, target.scrollHeight - target.clientHeight)
      setScrollTop(target.scrollTop)
      setMaxScroll(nextMax)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const getListViewScrollableContent = (): HTMLDivElement | null => {
    const container = document.getElementById('stick-headers-listview')
    if (!container) {
      return null
    }
    const scrollable = container.querySelector('.list-view-scrollable .scrollable-content')
    return scrollable instanceof HTMLDivElement ? scrollable : null
  }

  const scrollListViewByDelta = (delta: number): void => {
    const el = getListViewScrollableContent()
    if (!el) {
      return
    }

    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const next = Math.min(max, Math.max(0, el.scrollTop + delta))
    el.scrollTop = next
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: 16,
        gap: 16
      }}
    >

      {/* Bottom section: ListView on the left, scroll controls on the right */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          flex: 1,
          minHeight: 0
        }}
      >
        <div
          id="stick-headers-listview"
          style={{
            flex: '0 0 50%',
            height: '50%',
            border: '1px solid var(--vscode-panel-border)',
            boxSizing: 'border-box',
            padding: 8,
            overflow: 'hidden'
          }}
        >
          <ListView ariaLabel="Sticky headers tree">
            <ListViewItem title="Workspace" isExpanded>
              <ListViewItem title="src" isExpanded>
                <ListViewItem title="components" isExpanded>
                  <ListViewItem title="ListView.tsx" />
                  <ListViewItem title="ScrollableElement.tsx" />
                </ListViewItem>
                <ListViewItem title="pages" isExpanded>
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                </ListViewItem>
              </ListViewItem>
            </ListViewItem>
            <ListViewItem title="Workspace" isExpanded>
              <ListViewItem title="src" isExpanded>
                <ListViewItem title="components" isExpanded>
                  <ListViewItem title="ListView.tsx" />
                  <ListViewItem title="ScrollableElement.tsx" />
                </ListViewItem>
                <ListViewItem title="pages" isExpanded>
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                  <ListViewItem title="StickHeadersTab.tsx" />
                </ListViewItem>
              </ListViewItem>
            </ListViewItem>
          </ListView>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'flex-start'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <button
              type="button"
              onClick={() => {
                scrollListViewByDelta(-1)
              }}
              style={{
                padding: '4px 8px',
                cursor: 'pointer'
              }}
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => {
                scrollListViewByDelta(1)
              }}
              style={{
                padding: '4px 8px',
                cursor: 'pointer'
              }}
            >
              ▼
            </button>
            <button
              type="button"
              onClick={() => {
                scrollListViewByDelta(-10)
              }}
              style={{
                padding: '4px 8px',
                cursor: 'pointer'
              }}
            >
              ▲▲
            </button>
            <button
              type="button"
              onClick={() => {
                scrollListViewByDelta(10)
              }}
              style={{
                padding: '4px 8px',
                cursor: 'pointer'
              }}
            >
              ▼▼
            </button>
            <span>
              {Math.round(scrollTop)} / {Math.round(maxScroll)}
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 12
            }}
          >
          </div>
        </div>
      </div>
    </div>
  )
}

export default StickHeadersTab
