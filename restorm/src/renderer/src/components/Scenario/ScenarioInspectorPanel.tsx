import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ListView } from 'electron-core-ui/renderer'
import type { ScenarioPort } from '../../../../shared/types/collections'
import type { ScenarioNodeError } from './scenarioValidation'
import { buildScenarioPathTree } from './scenarioPathTree'

/** The single selected node previewed in the panel. */
export interface InspectorPreviewNode {
  id: string
  title: string
  note?: string
  outputs: ScenarioPort[]
}

export interface ScenarioInspectorPanelProps {
  scenarioId: string
  /** Flat list of every box error (with the box title), for the errors section. */
  errors: { nodeId: string; title: string; error: ScenarioNodeError }[]
  /** Distinct boxes in error — drives the section header count. */
  errorBoxCount: number
  /** Centre the canvas on a box (clicking an error row). */
  onFocusNode: (nodeId: string) => void
  /** The node to preview, or null when zero / many boxes are selected. */
  previewNode: InspectorPreviewNode | null
}

interface ScenarioRuntime {
  getScenarioNodeResult?: (scenarioId: string, nodeId: string) => Promise<Record<string, unknown> | null>
}
function scenarioRuntime(): ScenarioRuntime | undefined {
  return (window as { restorm?: { runtime?: ScenarioRuntime } }).restorm?.runtime
}

/** Pick an output's value out of the node's run result. Results are keyed by
 * output port id when a node emits several; a single-output node stores its
 * value as the whole result. */
function outputValue(result: Record<string, unknown> | null, port: ScenarioPort, outputCount: number): unknown {
  if (!result) return undefined
  if (port.id in result) return result[port.id]
  return outputCount === 1 ? result : undefined
}

/**
 * The scenario editor's side panel: a (visual-only) run toolbar, the workflow
 * error list, and a live preview of the single selected box — its name, note,
 * and each output's value rendered as a JSON tree. The preview shows only when
 * exactly one box is selected.
 */
export const ScenarioInspectorPanel: React.FC<ScenarioInspectorPanelProps> = ({ scenarioId, errors, errorBoxCount, onFocusNode, previewNode }) => {
  const { t } = useTranslation()
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const fetchToken = useRef(0)

  const previewId = previewNode?.id
  // Fetch the selected node's last run result whenever the selection changes.
  // The setState lives in the async callback (not the effect body), and a
  // generation token discards a stale fetch that resolves after the selection
  // already moved on.
  useEffect(() => {
    const token = ++fetchToken.current
    void (async () => {
      let res: Record<string, unknown> | null = null
      if (previewId) {
        try { res = (await scenarioRuntime()?.getScenarioNodeResult?.(scenarioId, previewId)) ?? null } catch { res = null }
      }
      if (fetchToken.current === token) setResult(res)
    })()
  }, [scenarioId, previewId])

  const hasErrors = errors.length > 0
  const noop = (): void => { /* toolbar is visual-only — not wired yet */ }

  return (
    <div className="scn-inspector nodrag nopan" data-testid="scenario-inspector-panel">
      {/* Run toolbar — visual only for now. */}
      <div className="scn-inspector-toolbar" data-testid="scenario-inspector-toolbar">
        <Button small secondary icon="play" onClick={noop} options={{ ariaLabel: t('scenario.inspector.run', 'Run'), title: t('scenario.inspector.run', 'Run') }} data-testid="scenario-inspector-run" />
        <Button small secondary icon="debug-alt" onClick={noop} options={{ ariaLabel: t('scenario.inspector.debug', 'Debug'), title: t('scenario.inspector.debug', 'Debug') }} data-testid="scenario-inspector-debug" />
        <Button small secondary icon="debug-step-over" onClick={noop} options={{ ariaLabel: t('scenario.inspector.step', 'Step'), title: t('scenario.inspector.step', 'Step') }} data-testid="scenario-inspector-step" />
      </div>

      {hasErrors && (
        <>
          <div className="scn-inspector-sep" />
          <div className="scn-inspector-section scn-inspector-errors">
            <div className="scn-inspector-section-title scn-inspector-errors-title">
              <i className="codicon codicon-error" aria-hidden="true" />
              {t('scenario.validation.panelTitle', { count: errorBoxCount, defaultValue: '{{count}} box error(s)' })}
            </div>
            {errors.map(({ nodeId, title, error }) => (
              <button
                key={`${nodeId}-${error.code}`}
                type="button"
                className="scn-error-row"
                onClick={() => { onFocusNode(nodeId) }}
                title={t('scenario.validation.focusBox', 'Focus this box')}
              >
                <span style={{ opacity: 0.8 }}>{title}</span> — {error.message}
              </button>
            ))}
          </div>
        </>
      )}

      {previewNode && (
        <>
          <div className="scn-inspector-sep" />
          <div className="scn-inspector-section scn-inspector-preview">
            <div className="scn-inspector-section-title scn-inspector-preview-header">{previewNode.title}</div>
            {previewNode.note && <div className="scn-inspector-note">{previewNode.note}</div>}
            {previewNode.outputs.length === 0 ? (
              <div className="scn-inspector-empty">{t('scenario.inspector.noOutputs', 'This box has no output.')}</div>
            ) : (
              previewNode.outputs.map((port) => {
                const value = outputValue(result, port, previewNode.outputs.length)
                return (
                  <div key={port.id} className="scn-inspector-output">
                    <div className="scn-inspector-output-label">{port.name || port.id}</div>
                    {value === undefined ? (
                      <div className="scn-inspector-empty">{t('scenario.inspector.notRun', 'Run the box to see its output.')}</div>
                    ) : (
                      <div className="scn-inspector-tree">
                        <ListView items={buildScenarioPathTree(value)} selectionMode="single" selectedIds={[]} style={{ height: 200 }} data-testid={`scenario-inspector-output-${port.id}`} />
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ScenarioInspectorPanel
