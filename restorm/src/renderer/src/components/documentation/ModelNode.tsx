import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ModelDocumentation, PropertyDocumentation, SchemaConstraints } from '../../../../shared/types/apiDocumentation'
import {
  MODEL_NODE_WIDTH,
  modelHeaderHeight,
  sourceHandleIdForProperty,
  targetHandleCenterY,
  targetHandleIdForIncomingEdge
} from './modelNodeMetrics'
import { DelayedTooltip } from './DelayedTooltip'

export interface ModelNodeData extends Record<string, unknown> {
  model: ModelDocumentation
  /** Stable, ordered list of edge ids whose target is this model.
   * Each id maps to one target handle distributed along the left
   * side of the node. The same ids are passed to ELK as `tgt:<id>`
   * ports so the routing engine sees one anchor per incoming edge
   * (no convergence overlap). */
  incomingEdgeIds?: string[]
  /** Total node height resolved by `estimateModelNodeHeight`, mirrored
   * here so the target-handle Y distribution stays in sync with the
   * size ELK was given. */
  nodeHeight?: number
}

function visibilityMarker(prop: PropertyDocumentation): string {
  // UML uses `+ public`, `- private`, `# protected`. APIs have no
  // visibility, so we repurpose the slot to convey requiredness:
  // `+` for required fields, `-` for optional. The `?` suffix on
  // optional names mirrors TypeScript's optional-property syntax,
  // which most readers parse instantly.
  return prop.required ? '+' : '-'
}

function propertyDisplayName(prop: PropertyDocumentation): string {
  const suffix = prop.required ? '' : '?'
  return `${prop.name}${suffix}`
}

function propertyTypeLabel(prop: PropertyDocumentation): string {
  if (prop.targetModelRef !== undefined) {
    return prop.isArrayOfRef === true ? `${prop.targetModelRef}[]` : prop.targetModelRef
  }
  return prop.type
}

function summariseConstraints(c: SchemaConstraints | undefined): string | undefined {
  if (!c) return undefined
  const bits: string[] = []
  if (c.minLength !== undefined || c.maxLength !== undefined) {
    bits.push(`length ${c.minLength ?? '?'}–${c.maxLength ?? '?'}`)
  }
  if (c.minimum !== undefined || c.maximum !== undefined) {
    bits.push(`${c.minimum ?? '−∞'} ≤ x ≤ ${c.maximum ?? '+∞'}`)
  }
  if (c.multipleOf !== undefined) bits.push(`× ${String(c.multipleOf)}`)
  if (c.pattern !== undefined) bits.push(`/${c.pattern}/`)
  if (c.uniqueItems === true) bits.push('unique')
  return bits.length > 0 ? bits.join(', ') : undefined
}

function formatExample(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function buildPropertyTooltip(prop: PropertyDocumentation): React.ReactNode {
  const parts: React.ReactNode[] = []
  if (prop.description !== undefined && prop.description.length > 0) {
    parts.push(<div key="desc" className="documentation-host-model-node__tooltip-line">{prop.description}</div>)
  }
  const example = formatExample(prop.example)
  if (example !== undefined) {
    parts.push(
      <div key="example" className="documentation-host-model-node__tooltip-line">
        <strong>Example:</strong> <code>{example}</code>
      </div>
    )
  }
  const constraints = summariseConstraints(prop.constraints)
  if (constraints !== undefined) {
    parts.push(
      <div key="constraints" className="documentation-host-model-node__tooltip-line">
        <strong>Constraints:</strong> <code>{constraints}</code>
      </div>
    )
  }
  if (parts.length === 0) return null
  return <div className="documentation-host-model-node__tooltip">{parts}</div>
}

interface ModelNodeHeaderProps {
  model: ModelDocumentation
}

const ModelNodeHeader: React.FC<ModelNodeHeaderProps> = ({ model }) => {
  const hasDescription = model.description !== undefined && model.description.length > 0
  const headerHeight = modelHeaderHeight(model)
  const headerStyle: React.CSSProperties = { height: headerHeight }

  const inner = (
    <>
      <div className="documentation-host-model-node__title-row">
        <span className="documentation-host-model-node__name">{model.name}</span>
        {model.deprecated === true && (
          <span className="documentation-host-model-node__badge documentation-host-model-node__badge--deprecated">
            deprecated
          </span>
        )}
        {model.removed === true && (
          <span className="documentation-host-model-node__badge documentation-host-model-node__badge--removed">
            removed
          </span>
        )}
      </div>
      {hasDescription && (
        <span className="documentation-host-model-node__description-line">
          {model.description}
        </span>
      )}
    </>
  )

  if (!hasDescription) {
    return (
      <header className="documentation-host-model-node__header" style={headerStyle}>
        {inner}
      </header>
    )
  }
  // Wrap the header in a delayed tooltip so the full description
  // surfaces on hover when it overflows the truncated single-line
  // display.
  return (
    <DelayedTooltip
      content={<div className="documentation-host-model-node__tooltip">{model.description}</div>}
      as="div"
      className="documentation-host-model-node__header-wrap"
    >
      <header className="documentation-host-model-node__header" style={headerStyle}>
        {inner}
      </header>
    </DelayedTooltip>
  )
}

export const ModelNode: React.FC<NodeProps> = ({ data }) => {
  const { model, incomingEdgeIds = [], nodeHeight } = data as ModelNodeData
  const totalIncoming = incomingEdgeIds.length
  return (
    <div
      className="documentation-host-model-node"
      data-testid={`documentation-host-model-node-${model.name}`}
      style={{ width: MODEL_NODE_WIDTH }}
    >
      {/* One target handle per incoming edge, distributed along the
          left side. The Y position has to match the ELK port that
          carries the same id, so we route through `targetHandleCenterY`
          for both sides. */}
      {incomingEdgeIds.map((edgeId, idx) => {
        const top = nodeHeight !== undefined
          ? targetHandleCenterY(nodeHeight, idx, totalIncoming)
          : undefined
        return (
          <Handle
            key={edgeId}
            type="target"
            position={Position.Left}
            id={targetHandleIdForIncomingEdge(edgeId)}
            className="documentation-host-model-node__handle documentation-host-model-node__handle--target"
            style={top !== undefined ? { top: `${String(top)}px`, transform: 'translate(-50%, -50%)' } : undefined}
          />
        )
      })}
      <ModelNodeHeader model={model} />

      <ul className="documentation-host-model-node__properties">
        {model.properties.map((prop) => {
          const tooltip = buildPropertyTooltip(prop)
          const rowClass =
            'documentation-host-model-node__property' +
            (prop.required ? ' documentation-host-model-node__property--required' : '') +
            (prop.deprecated === true ? ' documentation-host-model-node__property--deprecated' : '')
          const rowContents = (
            <>
              <span className="documentation-host-model-node__visibility">{visibilityMarker(prop)}</span>
              <span className="documentation-host-model-node__property-name">{propertyDisplayName(prop)}</span>
              <span className="documentation-host-model-node__property-sep">:</span>
              <span
                className={
                  'documentation-host-model-node__property-type' +
                  (prop.targetModelRef !== undefined ? ' documentation-host-model-node__property-type--ref' : '')
                }
              >
                {propertyTypeLabel(prop)}
              </span>
              {prop.nullable === true && (
                <span className="documentation-host-model-node__property-modifier">?</span>
              )}
              {prop.readOnly === true && (
                <span className="documentation-host-model-node__property-modifier">ro</span>
              )}
              {prop.targetModelRef !== undefined && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={sourceHandleIdForProperty(prop.name)}
                  className="documentation-host-model-node__handle documentation-host-model-node__handle--per-property"
                />
              )}
            </>
          )
          if (tooltip === null) {
            return (
              <li key={prop.name} className={rowClass}>
                {rowContents}
              </li>
            )
          }
          return (
            <DelayedTooltip
              key={prop.name}
              content={tooltip}
              as="li"
              className={rowClass}
            >
              {rowContents}
            </DelayedTooltip>
          )
        })}
      </ul>
    </div>
  )
}
