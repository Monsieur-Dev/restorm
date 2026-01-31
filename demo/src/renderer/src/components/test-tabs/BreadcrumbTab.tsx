import React, { useCallback, useMemo, useState } from 'react'
import { Breadcrumb, type BreadcrumbItem } from 'electron-core-ui/renderer'

interface BreadcrumbHarnessState {
  clickCount: number
  lastClickIndex: number | null
  lastClickId: string | null
  lastChangeValue: string | null
}

function createInitialItems(prefix: string): BreadcrumbItem[] {
  return [
    { id: `${prefix}-root`, label: 'Root' },
    { id: `${prefix}-section`, label: 'Section' },
    { id: `${prefix}-leaf`, label: 'Leaf' }
  ]
}

const BreadcrumbTab: React.FC = () => {
  const [mainItems, setMainItems] = useState<BreadcrumbItem[]>(() => createInitialItems('main'))
  const [delayedItems] = useState<BreadcrumbItem[]>(() => createInitialItems('delayed'))

  const [mainHarness, setMainHarness] = useState<BreadcrumbHarnessState>({
    clickCount: 0,
    lastClickIndex: null,
    lastClickId: null,
    lastChangeValue: null
  })

  const [delayedHarness, setDelayedHarness] = useState<BreadcrumbHarnessState>({
    clickCount: 0,
    lastClickIndex: null,
    lastClickId: null,
    lastChangeValue: null
  })

  const handleMainClick = useCallback((item: BreadcrumbItem, index: number): void => {
    setMainHarness((prev) => ({
      ...prev,
      clickCount: prev.clickCount + 1,
      lastClickIndex: index,
      lastClickId: item.id
    }))
  }, [])

  const handleMainLastItemChange = useCallback((item: BreadcrumbItem, newValue: string, index: number): void => {
    setMainHarness((prev) => ({
      ...prev,
      lastChangeValue: newValue
    }))

    setMainItems((prev) => {
      if (index < 0 || index >= prev.length) return prev
      const next = [...prev]
      const current = next[index]
      if (!current) return prev
      next[index] = { ...current, label: newValue, id: item.id }
      return next
    })
  }, [])

  const handleDelayedClick = useCallback((item: BreadcrumbItem, index: number): void => {
    setDelayedHarness((prev) => ({
      ...prev,
      clickCount: prev.clickCount + 1,
      lastClickIndex: index,
      lastClickId: item.id
    }))
  }, [])

  const handleDelayedLastItemChange = useCallback((_item: BreadcrumbItem, newValue: string): void => {
    // Intentionally do NOT update delayedItems labels: this is used to verify
    // Breadcrumb's internal committed value display until the parent updates.
    setDelayedHarness((prev) => ({
      ...prev,
      lastChangeValue: newValue
    }))
  }, [])

  const sectionStyle = useMemo<React.CSSProperties>(() => ({
    padding: 20,
    maxWidth: 900,
    display: 'grid',
    gap: 16
  }), [])

  const cardStyle = useMemo<React.CSSProperties>(() => ({
    border: '1px solid var(--panel-border)',
    backgroundColor: 'var(--sideBar-background)',
    padding: 16,
    borderRadius: 4,
    display: 'grid',
    gap: 10
  }), [])

  const metaGridStyle = useMemo<React.CSSProperties>(() => ({
    display: 'grid',
    gridTemplateColumns: '220px 1fr',
    gap: 8,
    alignItems: 'center',
    fontSize: 13
  }), [])

  const metaKeyStyle = useMemo<React.CSSProperties>(() => ({
    color: 'var(--descriptionForeground)'
  }), [])

  return (
    <div style={sectionStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>Breadcrumb (editable last item)</h3>

        <Breadcrumb
          data-testid="breadcrumb-main"
          items={mainItems}
          onItemClick={handleMainClick}
          onLastItemChange={handleMainLastItemChange}
        />

        {/* Test-friendly event log */}
        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>click count</div>
          <div data-testid="breadcrumb-main-click-count">{String(mainHarness.clickCount)}</div>

          <div style={metaKeyStyle}>last click index</div>
          <div data-testid="breadcrumb-main-last-click-index">{mainHarness.lastClickIndex === null ? '' : String(mainHarness.lastClickIndex)}</div>

          <div style={metaKeyStyle}>last click id</div>
          <div data-testid="breadcrumb-main-last-click-id">{mainHarness.lastClickId ?? ''}</div>

          <div style={metaKeyStyle}>last change value</div>
          <div data-testid="breadcrumb-main-last-change">{mainHarness.lastChangeValue ?? ''}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>Breadcrumb (delayed parent update)</h3>

        <Breadcrumb
          data-testid="breadcrumb-delayed"
          items={delayedItems}
          onItemClick={handleDelayedClick}
          onLastItemChange={handleDelayedLastItemChange}
        />

        {/* Test-friendly event log */}
        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>click count</div>
          <div data-testid="breadcrumb-delayed-click-count">{String(delayedHarness.clickCount)}</div>

          <div style={metaKeyStyle}>last click index</div>
          <div data-testid="breadcrumb-delayed-last-click-index">{delayedHarness.lastClickIndex === null ? '' : String(delayedHarness.lastClickIndex)}</div>

          <div style={metaKeyStyle}>last click id</div>
          <div data-testid="breadcrumb-delayed-last-click-id">{delayedHarness.lastClickId ?? ''}</div>

          <div style={metaKeyStyle}>last change value</div>
          <div data-testid="breadcrumb-delayed-last-change">{delayedHarness.lastChangeValue ?? ''}</div>
        </div>
      </div>
    </div>
  )
}

export default BreadcrumbTab
