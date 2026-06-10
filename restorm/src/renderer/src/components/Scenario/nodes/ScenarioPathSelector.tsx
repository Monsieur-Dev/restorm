import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ControlGroup, InputBox, ListView, Tooltip } from 'electron-core-ui/renderer'
import { buildScenarioPathTree } from '../scenarioPathTree'
import { useScenarioEdgeSelector } from '../scenarioEdgeSelector'
import { useScenarioStaticPreview } from '../scenarioStaticPreviewContext'

export interface ScenarioPathSelectorProps {
  /** Edge whose `selector` this control edits. */
  edgeId: string
  /** Upstream box feeding this input — its run result fills the picker. */
  sourceNodeId: string
  /** Owning scenario id (needed to fetch / run the upstream box). */
  scenarioId?: string
  /** The input's label, shown above the control. */
  label?: string
  /** Outline the control group red (e.g. the path is empty / malformed). */
  invalid?: boolean
}

type OutputContext = Record<string, unknown> | null

/** The scenario run/result bridge. Accessed via cast (the global `window.restorm`
 * typing doesn't surface `runtime`), mirroring the node header's play button. */
interface ScenarioRuntime {
  getScenarioNodeResult?: (scenarioId: string, nodeId: string) => Promise<Record<string, unknown> | null>
}
function scenarioRuntime(): ScenarioRuntime | undefined {
  return (window as { restorm?: { runtime?: ScenarioRuntime } }).restorm?.runtime
}

/**
 * The JSON-path control shown on a data link's receiving input: a textbox
 * holding the edge's `selector` joined with a `target` button. The button opens
 * a popover tree of the upstream box's last run result; clicking a property
 * writes its dot-path into the selector. When the source hasn't run yet, the
 * popover offers to run it first.
 */
export const ScenarioPathSelector: React.FC<ScenarioPathSelectorProps> = ({ edgeId, sourceNodeId, scenarioId, label, invalid }) => {
  const { t } = useTranslation()
  const api = useScenarioEdgeSelector()
  const staticApi = useScenarioStaticPreview()

  const [value, setValue] = useState<string>(() => api?.getSelector(edgeId) ?? '')
  const [open, setOpen] = useState(false)
  // undefined = not fetched yet, null = no result (box not run), object = result.
  const [result, setResult] = useState<OutputContext | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Re-sync the textbox when this control is reused for a different edge
  // (React Flow recycles cell components) or the edge's selector changes from
  // outside (an MCP re-seed). Keyed on edgeId so it never clobbers in-progress
  // typing on the same edge.
  useEffect(() => { setValue(api?.getSelector(edgeId) ?? '') }, [edgeId, api])

  const commit = useCallback((next: string) => {
    setValue(next)
    api?.setSelector(edgeId, next)
  }, [api, edgeId])

  const fetchResult = useCallback(async () => {
    // A static-preview source (input, getVariable, now, transform, …) feeds
    // its config-derived preview straight in — no run needed. Only fall back
    // to the runtime fetch when the source kind isn't statically previewable.
    const staticPreview = staticApi?.getPreview(sourceNodeId) ?? null
    if (staticPreview !== null) {
      setResult(staticPreview)
      return
    }
    if (!scenarioId) return
    setLoading(true)
    try {
      const res = await scenarioRuntime()?.getScenarioNodeResult?.(scenarioId, sourceNodeId)
      setResult(res ?? null)
    } catch {
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [scenarioId, sourceNodeId, staticApi])

  const toggleOpen = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) void fetchResult()
      return !wasOpen
    })
  }, [fetchResult])

  // Close the popover on a click outside both the control and the (portalled)
  // popover. The popover lives in a portal, so it must be excluded explicitly.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const tgt = e.target as Node
      if (rootRef.current?.contains(tgt) || popoverRef.current?.contains(tgt)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => { document.removeEventListener('mousedown', onDown, true) }
  }, [open])

  const tree = useMemo(() => (result ? buildScenarioPathTree(result) : []), [result])

  const popover = (
    <div ref={popoverRef} className="scn-path-popover nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
      {loading ? (
        <div className="scn-path-popover-msg">{t('scenario.pathSelector.loading', 'Loading…')}</div>
      ) : result ? (
        <ListView
          items={tree}
          selectionMode="single"
          selectedIds={value ? [value] : []}
          onItemClick={({ item }) => { commit(item.id); setOpen(false) }}
          style={{ width: 300, height: 280 }}
          data-testid="scn-path-tree"
        />
      ) : (
        <div className="scn-path-popover-empty">
          <span>{t('scenario.pathSelector.noResult', 'Run the source action to pick a property from its result.')}</span>
        </div>
      )}
    </div>
  )

  return (
    <div
      ref={rootRef}
      className="scn-path-selector nodrag"
      onMouseDown={(e) => { e.stopPropagation() }}
      onDragOver={(e) => {
        // Accept a property dragged from the inspector preview (its tree row id
        // is the JSON path) — drop sets this link's selector to that path.
        if (e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
      }}
      onDrop={(e) => {
        const path = e.dataTransfer.getData('text/plain')
        if (path) { e.preventDefault(); commit(path) }
      }}
    >
      {label !== undefined && <span className="scn-port-label scn-path-label">{label}</span>}
      <ControlGroup className={`scn-path-controls${invalid ? ' scn-field-invalid' : ''}`}>
        <InputBox
          options={{ placeholder: t('scenario.pathSelector.placeholder', 'JSON path'), ariaLabel: t('scenario.pathSelector.ariaLabel', 'JSON path selector') }}
          value={value}
          onChange={commit}
          data-testid="scn-path-input"
        />
        <span ref={targetRef} className="scn-path-target">
          <Button
            medium
            secondary
            icon="target"
            onClick={toggleOpen}
            options={{ ariaLabel: t('scenario.pathSelector.pick', 'Pick from result'), title: t('scenario.pathSelector.pick', 'Pick from result') }}
            data-testid="scn-path-pick"
          />
        </span>
      </ControlGroup>
      <Tooltip
        targetRef={targetRef}
        show={open}
        placement="below"
        side="auto"
        className="scn-path-tooltip"
        repositionKey={open ? `${edgeId}:${result === undefined ? 'loading' : result === null ? 'empty' : 'tree'}` : null}
        content={popover}
        data-testid="scn-path-popover-tooltip"
      />
    </div>
  )
}

export default ScenarioPathSelector
