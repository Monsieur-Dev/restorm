import React, { useState, useEffect } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'

interface ResizablePanelProps {
  leftPanel: React.ReactNode
  rightPanel: React.ReactNode
  defaultWidth?: number
  minWidth?: number
  storageKey?: string
}

const STORAGE_KEY = 'workbench.appearance.tocWidth'
const DEFAULT_TOC_WIDTH = 250
const MIN_TOC_WIDTH = 150
const MAX_TOC_WIDTH = 500

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  leftPanel,
  rightPanel,
  defaultWidth = DEFAULT_TOC_WIDTH,
  minWidth = MIN_TOC_WIDTH,
  storageKey = STORAGE_KEY
}) => {
  const [sizes, setSizes] = useState<number[]>([defaultWidth, 1000])

  // Load saved width from storage on mount
  useEffect(() => {
    const loadSavedWidth = async (): Promise<void> => {
      try {
        const savedWidth = await window.settingsAPI.getSetting<number>(storageKey)
        if (savedWidth && savedWidth >= minWidth && savedWidth <= MAX_TOC_WIDTH) {
          setSizes([savedWidth, 1000])
        }
      } catch (error) {
        console.error('Failed to load TOC width:', error)
      }
    }

    loadSavedWidth().catch(console.error)
  }, [storageKey, minWidth])

  // Save width when changed
  const handleChange = (newSizes: number[]): void => {
    setSizes(newSizes)
    const newWidth = newSizes[0]
    
    // Debounce save to avoid too many writes
    if (newWidth >= minWidth && newWidth <= MAX_TOC_WIDTH) {
      window.settingsAPI.setSetting(storageKey, newWidth).catch((error) => {
        console.error('Failed to save TOC width:', error)
      })
    }
  }

  return (
    <Allotment defaultSizes={sizes} onChange={handleChange}>
      <Allotment.Pane minSize={minWidth} maxSize={MAX_TOC_WIDTH}>
        {leftPanel}
      </Allotment.Pane>
      <Allotment.Pane>
        {rightPanel}
      </Allotment.Pane>
    </Allotment>
  )
}
