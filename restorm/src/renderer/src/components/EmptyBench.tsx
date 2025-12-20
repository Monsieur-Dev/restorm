import React from 'react'
import './EmptyBench.css'

/**
 * EmptyBench component displayed when a file is open but no tabs are open in the workbench
 */
export const EmptyBench: React.FC = () => {
  return (
    <div className="empty-bench-container">
      <img 
        src="/imgs/logo_400.png" 
        alt="Restorm" 
        className="empty-bench-logo"
      />
    </div>
  )
}

export default EmptyBench
