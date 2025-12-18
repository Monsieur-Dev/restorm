import React from 'react'

/**
 * Welcome component displayed when no tabs are open in the workbench
 */
export const Welcome: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--descriptionForeground)',
        backgroundColor: 'var(--editor-background)'
      }}
    >
      <span>Hello restorm</span>
    </div>
  )
}

export default Welcome
