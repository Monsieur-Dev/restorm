import React from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Inline legend for the badges + suffix conventions used in the
 * model graph. Sits below the graph itself; without it the meaning
 * of `?`, `ro`, the trailing `?` on property names, the
 * deprecated/removed pills, and the edge stroke colours / dash
 * styles isn't obvious to a reader landing on the documentation
 * cold.
 */
export const ModelGraphLegend: React.FC = () => {
  const { t } = useTranslation()
  return (
    <ul
      className="documentation-host-model-graph-legend"
      data-testid="documentation-host-model-graph-legend"
    >
      <li className="documentation-host-model-graph-legend__item">
        <code className="documentation-host-model-graph-legend__sample">+ name</code>
        <span className="documentation-host-model-graph-legend__label">{t('documentation.legend.requiredProperty')}</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <code className="documentation-host-model-graph-legend__sample">- name?</code>
        <span className="documentation-host-model-graph-legend__label">{t('documentation.legend.optionalProperty')}</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-node__property-modifier">?</span>
        <span className="documentation-host-model-graph-legend__label">{t('documentation.legend.nullableValue')}</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-node__property-modifier">ro</span>
        <span className="documentation-host-model-graph-legend__label">{t('documentation.legend.readOnly')}</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-node__badge documentation-host-model-node__badge--deprecated">
          {t('documentation.legend.deprecatedBadge')}
        </span>
        <span className="documentation-host-model-graph-legend__label">
          {t('documentation.legend.deprecatedDesc')}
        </span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-node__badge documentation-host-model-node__badge--removed">
          {t('documentation.legend.removedBadge')}
        </span>
        <span className="documentation-host-model-graph-legend__label">
          {t('documentation.legend.removedDesc')}
        </span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-graph-legend__edge documentation-host-model-graph-legend__edge--single-required" aria-hidden="true" />
        <span className="documentation-host-model-graph-legend__label">{t('documentation.legend.requiredSingleRef')}</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-graph-legend__edge documentation-host-model-graph-legend__edge--single-optional" aria-hidden="true" />
        <span className="documentation-host-model-graph-legend__label">{t('documentation.legend.optionalSingleRef')}</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-graph-legend__edge documentation-host-model-graph-legend__edge--array-required" aria-hidden="true" />
        <span className="documentation-host-model-graph-legend__label">{t('documentation.legend.requiredArrayRef')}</span>
      </li>
      <li className="documentation-host-model-graph-legend__item">
        <span className="documentation-host-model-graph-legend__edge documentation-host-model-graph-legend__edge--array-optional" aria-hidden="true" />
        <span className="documentation-host-model-graph-legend__label">{t('documentation.legend.optionalArrayRef')}</span>
      </li>
    </ul>
  )
}
