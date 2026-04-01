import React, { useState } from 'react'
import { Tabs } from 'electron-core-ui/renderer'
import type { Tab } from 'electron-core-ui/renderer'

const TabsTab: React.FC = () => {
  const [activeTabId, setActiveTabId] = useState('tab-1')

  const tabs: Tab[] = [
    { id: 'tab-1', label: 'First Tab', content: <div data-testid="tabs-test-content-tab-1">Content of first tab</div> },
    { id: 'tab-2', label: 'Second Tab', content: <div data-testid="tabs-test-content-tab-2">Content of second tab</div> },
    { id: 'tab-3', label: 'Third Tab', content: <div data-testid="tabs-test-content-tab-3">Content of third tab</div> }
  ]

  return (
    <div style={{ display: 'grid', gap: 16, padding: 20 }}>
      <div data-testid="tabs-ready">true</div>

      <div style={{ height: 300 }}>
        <Tabs
          tabs={tabs}
          activeTabId={activeTabId}
          onTabChange={setActiveTabId}
          data-testid="tabs-test"
        />
      </div>

      <div data-testid="tabs-active-tab-id">{activeTabId}</div>
    </div>
  )
}

export default TabsTab
