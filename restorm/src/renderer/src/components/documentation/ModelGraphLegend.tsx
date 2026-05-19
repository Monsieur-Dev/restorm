import React from 'react'

/**
 * Inline legend for the badges + suffix conventions used in the
 * model graph. Sits below the graph itself; without it the meaning
 * of `?`, `ro`, the trailing `?` on property names, the
 * deprecated/removed pills, and the edge stroke colours / dash
 * styles isn't obvious to a reader landing on the documentation
 * cold.
 */
export const ModelGraphLegend: React.FC = () => {
  return (
    <ul
      className="documentation-host-model-graph-legend"
      data-testid="documentation-host-model-graph-legend"
    >
      <li className="documentation-host-model-graph-legend__item">
        <code className="documentation-host-model-graph-legend__sample">+ name</code>
        <span className="documentation-host-model-graph-legend__label">required property</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <code className="documentation-host-model-graph-legend__sample">- name?</code>
        <span className="documentation-host-model-graph-legend__label">optional property</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-node__property-modifier">?</span>
        <span className="documentation-host-model-graph-legend__label">nullable value</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-node__property-modifier">ro</span>
        <span className="documentation-host-model-graph-legend__label">read-only (server-set)</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-node__badge documentation-host-model-node__badge--deprecated">
          deprecated
        </span>
        <span className="documentation-host-model-graph-legend__label">
          declared deprecated in the source spec
        </span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-node__badge documentation-host-model-node__badge--removed">
          removed
        </span>
        <span className="documentation-host-model-graph-legend__label">
          gone from the most recent re-import
        </span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span
          className="documentation-host-model-graph-legend__enum-swatch"
          aria-hidden="true"
        />
        <span className="documentation-host-model-graph-legend__label">
          enum model (light-blue border)
        </span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-graph-legend__edge documentation-host-model-graph-legend__edge--single-required" aria-hidden="true" />
        <span className="documentation-host-model-graph-legend__label">required single ref</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-graph-legend__edge documentation-host-model-graph-legend__edge--single-optional" aria-hidden="true" />
        <span className="documentation-host-model-graph-legend__label">optional single ref</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-graph-legend__edge documentation-host-model-graph-legend__edge--array-required" aria-hidden="true" />
        <span className="documentation-host-model-graph-legend__label">required array ref</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-graph-legend__edge documentation-host-model-graph-legend__edge--array-optional" aria-hidden="true" />
        <span className="documentation-host-model-graph-legend__label">optional array ref</span>
      </li>
    </ul>
  )
}
