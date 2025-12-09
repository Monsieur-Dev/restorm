import React from 'react'

const PanelsTab: React.FC = () => {
  return (
    <div style={{ display: 'grid', gap: '20px', padding: '20px' }}>
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--vscode-sideBar-background)',
            border: '1px solid var(--vscode-panel-border)',
            borderRadius: '4px'
          }}
        >
          <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Panel with Sidebar Background</h3>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--vscode-descriptionForeground)'
            }}
          >
            This is a panel with sidebar background color and border.
          </p>
        </div>

        <div
          style={{
            border: '1px solid var(--vscode-panel-border)',
            borderRadius: '4px',
            overflow: 'hidden'
          }}
        >
          <h3 style={{ margin: '0', padding: '12px', fontSize: '14px', backgroundColor: 'var(--vscode-sideBar-background)', borderBottom: '1px solid var(--vscode-panel-border)' }}>List</h3>
          {['Item 1', 'Item 2 (hover me)', 'Item 3'].map((item, index) => (
            <div
              key={index}
              style={{
                padding: '10px 12px',
                fontSize: '13px',
                backgroundColor: index === 0 
                  ? 'var(--vscode-list-activeSelectionBackground)' 
                  : 'var(--vscode-sideBar-background)',
                color: index === 0
                  ? 'var(--vscode-list-activeSelectionForeground)'
                  : 'var(--vscode-foreground)',
                borderBottom: index < 2 ? '1px solid var(--vscode-panel-border)' : 'none',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                if (index !== 0) {
                  e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground)'
                }
              }}
              onMouseLeave={(e) => {
                if (index !== 0) {
                  e.currentTarget.style.backgroundColor = 'var(--vscode-sideBar-background)'
                }
              }}
            >
              {item} {index === 0 ? '(selected)' : ''}
            </div>
          ))}
        </div>
      </div>
  )
}

export default PanelsTab
