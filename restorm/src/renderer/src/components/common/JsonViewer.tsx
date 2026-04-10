/**
 * JsonViewer — reusable JSONCrack graph viewer with zoom controls.
 *
 * Features:
 * - Zoom in / zoom out / center view buttons
 * - Mouse wheel zoom (via zoomIn/zoomOut API, non-passive listener)
 * - Auto-centers the view on mount
 */

import React, { Suspense, useEffect, useRef, useState } from 'react'
import type { GraphRef } from 'jsoncrack-react'
import { Button } from 'electron-core-ui/renderer'

const Graph = React.lazy(() => import('jsoncrack-react').then(mod => ({ default: mod.Graph })))

export interface JsonViewerProps {
  /** JSON string to visualize */
  json: string
  /** Whether to use dark theme */
  darkTheme?: boolean
  /** Test ID prefix */
  'data-testid'?: string
}

export const JsonViewer: React.FC<JsonViewerProps> = ({
  json,
  darkTheme = true,
  'data-testid': testId
}) => {
  const graphRef = useRef<GraphRef | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [graphKey] = useState(() => 1)

  // Wheel zoom — non-passive listener so preventDefault works without React 19 warning
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const api = graphRef.current
      if (!api) return
      if (event.deltaY < 0) {
        api.zoomIn()
      } else if (event.deltaY > 0) {
        api.zoomOut()
      }
    }
    el.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => { el.removeEventListener('wheel', handleWheel, { capture: true }) }
  })

  // Auto-center after graph renders
  useEffect(() => {
    const timer = setTimeout(() => {
      graphRef.current?.centerView()
    }, 300)
    return () => { clearTimeout(timer) }
  }, [graphKey])

  return (
    <div
      ref={containerRef}
      style={{
        boxSizing: 'border-box',
        padding: '8px 0px 0px 8px',
        width: '100%',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <div style={{
          flex: 1,
          minHeight: 0,
          border: '1px solid var(--panel-border)',
          borderRadius: 3,
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 4,
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 1
          }}>
            <Button
              secondary
              small
              icon="zoom-in"
              options={{ ariaLabel: 'Zoom in', title: 'Zoom in' }}
              onClick={() => { graphRef.current?.zoomIn() }}
              {...(testId ? { 'data-testid': `${testId}-zoom-in` } : {})}
            />
            <Button
              secondary
              small
              icon="zoom-out"
              options={{ ariaLabel: 'Zoom out', title: 'Zoom out' }}
              onClick={() => { graphRef.current?.zoomOut() }}
              {...(testId ? { 'data-testid': `${testId}-zoom-out` } : {})}
            />
            <Button
              secondary
              small
              icon="screen-full"
              options={{ ariaLabel: 'Center view', title: 'Center view' }}
              onClick={() => { graphRef.current?.centerView() }}
              {...(testId ? { 'data-testid': `${testId}-center-view` } : {})}
            />
          </div>
          <Suspense fallback={
            <div role="status" aria-label="Loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            </div>
          }>
            <Graph
              key={graphKey}
              ref={graphRef}
              json={json || '{}'}
              layout={{ theme: darkTheme ? 'dark' : 'light' }}
              style={{ width: '100%', height: '100%' }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export default JsonViewer
