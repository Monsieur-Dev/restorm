import React from 'react'

const TextTab: React.FC = () => {
  return (
    <div style={{ display: 'grid', gap: '10px', padding: '20px' }}>
        <div style={{ 
          padding: '12px', 
          backgroundColor: 'var(--ecui-sideBar-background)',
          border: '1px solid var(--ecui-panel-border)',
          borderRadius: '4px',
          marginBottom: '10px'
        }}>
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: 'var(--ecui-descriptionForeground)' }}>
            Current font: <code style={{ fontSize: '11px' }}>{window.getComputedStyle(document.body).fontFamily}</code>
          </p>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--ecui-descriptionForeground)' }}>
            Expected: Inter (bundled with app)
          </p>
        </div>
        
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--ecui-foreground)' }}>
          Normal text with foreground color
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--ecui-descriptionForeground)' }}>
          Description text with muted color
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--ecui-errorForeground)' }}>
          Error text (if available)
        </p>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>
          Bold text (weight: 700)
        </p>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: '500' }}>
          Medium text (weight: 500)
        </p>
        <p style={{ margin: 0, fontSize: '13px', fontStyle: 'italic' }}>
          Italic text
        </p>
        <code
          style={{
            display: 'inline-block',
            padding: '2px 6px',
            fontSize: '12px',
            backgroundColor: 'var(--ecui-textCodeBlock-background)',
            border: '1px solid var(--ecui-panel-border)',
            borderRadius: '3px',
            fontFamily: 'inherit'
          }}
        >
          inline code
        </code>
        
        <div style={{ marginTop: '20px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Font Samples</h3>
          <p style={{ margin: '5px 0', fontSize: '20px' }}>The quick brown fox jumps</p>
          <p style={{ margin: '5px 0', fontSize: '16px' }}>The quick brown fox jumps over the lazy dog</p>
          <p style={{ margin: '5px 0', fontSize: '13px' }}>The quick brown fox jumps over the lazy dog 0123456789</p>
          <p style={{ margin: '5px 0', fontSize: '11px' }}>The quick brown fox jumps over the lazy dog</p>
        </div>
      </div>
  )
}

export default TextTab
