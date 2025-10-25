import React from 'react'
import { ProgressBar } from 'electron-vscodelike-core-ui/renderer'

const ProgressTab: React.FC = () => {
  return (
    <div style={{ display: 'grid', gap: '20px', maxWidth: '600px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>VSCode ProgressBar Components</h3>
        
        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Infinite Progress Bar</h4>
          <ProgressBar mode="infinite" />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Continuous progress indicator with animation
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Discrete Progress Bar (50%)</h4>
          <ProgressBar mode="discrete" value={50} total={100} />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Progress bar showing 50% completion
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Discrete Progress Bar (75%)</h4>
          <ProgressBar mode="discrete" value={75} total={100} />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Progress bar showing 75% completion
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Custom Color Progress Bar</h4>
          <ProgressBar 
            mode="discrete" 
            value={30} 
            total={100}
            options={{ progressBarBackground: '#ff6b6b' }}
          />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Progress bar with custom red color
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Completed Progress Bar</h4>
          <ProgressBar mode="done" />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Progress bar in completed state
          </p>
        </div>
      </div>
  )
}

export default ProgressTab
