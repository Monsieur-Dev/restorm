import React from 'react'
import { useTranslation } from 'react-i18next'
import { SplitView, Pane } from 'electron-core-ui/renderer'

const SplitViewE2ETab: React.FC = () => {
  const { t } = useTranslation()

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%' }}>
      <div style={{ width: 320, minWidth: 320, height: '100%', borderRight: '1px solid var(--panel-border)' }}>
        <SplitView data-testid="splitview" style={{ width: '100%', height: '100%' }}>
          <Pane id="red" title={t('splitView.harness.panes.red')} initialSize={0.5} minSize={80} collapsed={false}>
            <div data-testid="splitview-pane-red-content" style={{ width: '100%', height: '100%', backgroundColor: 'red' }} />
          </Pane>
          <Pane id="green" title={t('splitView.harness.panes.green')} initialSize={0.25} minSize={80} collapsed={false}>
            <div data-testid="splitview-pane-green-content" style={{ width: '100%', height: '100%', backgroundColor: 'green' }} />
          </Pane>
          <Pane id="blue" title={t('splitView.harness.panes.blue')} initialSize={0.25} minSize={80} collapsed={false}>
            <div data-testid="splitview-pane-blue-content" style={{ width: '100%', height: '100%', backgroundColor: 'blue' }} />
          </Pane>
        </SplitView>
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: 16 }}>
        <div data-testid="splitview-ready">true</div>
      </div>
    </div>
  )
}

export default SplitViewE2ETab
