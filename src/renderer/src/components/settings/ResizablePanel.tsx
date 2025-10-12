import React from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'

interface ResizablePanelProps {
  leftPanel: React.ReactNode
  rightPanel: React.ReactNode
  defaultWidth?: number
  minWidth?: number
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  leftPanel,
  rightPanel,
  defaultWidth = 250,
  minWidth = 150
}) => {
  return (
    <Allotment defaultSizes={[defaultWidth, 1000]}>
      <Allotment.Pane minSize={minWidth} maxSize={500}>
        {leftPanel}
      </Allotment.Pane>
      <Allotment.Pane>
        {rightPanel}
      </Allotment.Pane>
    </Allotment>
  )
}
