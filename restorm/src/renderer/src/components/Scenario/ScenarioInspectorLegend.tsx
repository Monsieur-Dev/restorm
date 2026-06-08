import React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollableElement } from 'electron-core-ui/renderer'
import {
  MouseScrollIcon,
  MouseLeftClickIcon,
  MouseMiddleClickIcon,
  ArrowsOutCardinalIcon
} from '@phosphor-icons/react'
import { ScenarioCliHelp } from './ScenarioCliHelp'

/**
 * The help legend shown in the empty inspector (no run-log to display): what the
 * node / port colours mean, the graph navigation shortcuts, and — when a scenario
 * is identified — the command line to run it headlessly. Discreet, i18n. Stays
 * visible as a footer even when a single action is selected (its help sits
 * above). Colours are representative of the box/port scheme, not theme-exact.
 */
export const ScenarioInspectorLegend: React.FC<{ cliScenarioName?: string; cliScenarioId?: string }> = ({ cliScenarioName, cliScenarioId }) => {
  const { t } = useTranslation()
  return (
    <div className="scn-inspector-section scn-inspector-legend" data-testid="scenario-inspector-legend">
      {/* The help can be taller than the panel on a short canvas — its own
        * scroller keeps it inside the frame (the section shrinks, this scrolls)
        * instead of spilling past it. */}
      <ScrollableElement className="scn-inspector-legend-scroll" options={{ horizontal: 'hidden' }}>
      <div className="scn-inspector-legend-body">
      <div className="scn-inspector-section-title">{t('scenario.legend.title', 'Legend')}</div>

      <div className="scn-legend-group-title">{t('scenario.legend.portsTitle', 'Points d\'entrée')}</div>
      <ul className="scn-legend-list scn-legend-ports">
        <li>
          <span className="scn-legend-port" aria-hidden="true">
            <span className="scn-legend-port-edge" />
            <span className="scn-legend-port-dot scn-legend-port-dot--signal" />
          </span>
          {t('scenario.legend.entryEventTrigger', 'Point d\'entrée déclenché par un évènement')}
        </li>
        <li>
          <span className="scn-legend-port" aria-hidden="true">
            <span className="scn-legend-port-edge" />
            <span className="scn-legend-port-dot scn-legend-port-dot--value" />
          </span>
          {t('scenario.legend.entryDataTrigger', 'Point d\'entrée déclenché par une donnée')}
        </li>
        <li className="scn-legend-note">
          {t(
            'scenario.legend.runWhenAllReceived',
            'Les actions sont exécutées dès que tous les évènements et toutes les données ont été reçues'
          )}
        </li>
        <li className="scn-legend-note">
          {t(
            'scenario.legend.runOnLaunchNoPredecessor',
            'Les actions sans prédécesseur sont exécutées dès le lancement du scénario'
          )}
        </li>
      </ul>

      <div className="scn-legend-group-title">{t('scenario.legend.outPortsTitle', 'Points de sortie')}</div>
      <ul className="scn-legend-list scn-legend-ports">
        <li>
          <span className="scn-legend-port scn-legend-port--out" aria-hidden="true">
            <span className="scn-legend-port-edge" />
            <span className="scn-legend-port-dot scn-legend-port-dot--both" />
          </span>
          {t('scenario.legend.outEmit', 'Émet un évènement déclencheur et envoie de la donnée')}
        </li>
        <li>
          <span className="scn-legend-port scn-legend-port--out" aria-hidden="true">
            <span className="scn-legend-port-edge" />
            <span className="scn-legend-port-dot scn-legend-port-dot--signal" />
          </span>
          {t('scenario.legend.outEmitSignalOnly', 'Émet un évènement déclencheur sans envoyer de donnée')}
        </li>
      </ul>

      <div className="scn-legend-group-title">{t('scenario.legend.genericOutPortsTitle', 'Points de sortie génériques')}</div>
      <ul className="scn-legend-list scn-legend-ports">
        <li>
          <span className="scn-legend-port scn-legend-port--bottom" aria-hidden="true">
            <span className="scn-legend-port-edge" />
            <span className="scn-legend-port-dot scn-legend-port-dot--signal scn-legend-port-dot--done" />
          </span>
          {t('scenario.legend.outDone', 'Évènement déclencheur émis quand l\'action est terminée')}
        </li>
        <li>
          <span className="scn-legend-port scn-legend-port--bottom" aria-hidden="true">
            <span className="scn-legend-port-edge" />
            <span className="scn-legend-port-dot scn-legend-port-dot--both scn-legend-port-dot--error" />
          </span>
          {t('scenario.legend.outError', 'Évènement déclencheur activé en cas d\'erreur sur l\'action')}
        </li>
      </ul>

      <div className="scn-legend-group-title">{t('scenario.legend.navTitle', 'Navigation')}</div>
      <ul className="scn-legend-list scn-legend-nav">
        <li>
          <MouseScrollIcon className="scn-legend-nav-icon" aria-hidden="true" />
          <span className="scn-legend-nav-label">{t('scenario.legend.zoom', 'zoom')}</span>
        </li>
        <li>
          <MouseMiddleClickIcon className="scn-legend-nav-icon" aria-hidden="true" />
          <span className="scn-legend-nav-plus" aria-hidden="true">+</span>
          <ArrowsOutCardinalIcon className="scn-legend-nav-icon" aria-hidden="true" />
          <span className="scn-legend-nav-label">{t('scenario.legend.pan', 'déplacer')}</span>
        </li>
        <li>
          <MouseLeftClickIcon className="scn-legend-nav-icon" aria-hidden="true" />
          <span className="scn-legend-nav-plus" aria-hidden="true">+</span>
          <ArrowsOutCardinalIcon className="scn-legend-nav-icon" aria-hidden="true" />
          <span className="scn-legend-nav-label">{t('scenario.legend.boxSelect', 'sélection rectangle')}</span>
        </li>
        <li>
          <MouseLeftClickIcon className="scn-legend-nav-icon" aria-hidden="true" />
          <span className="scn-legend-nav-plus" aria-hidden="true">+</span>
          <span className="scn-legend-nav-kbd">
            <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>
          </span>
          <span className="scn-legend-nav-label">{t('scenario.legend.select', 'sélectionner / multi-sélection')}</span>
        </li>
      </ul>

      {cliScenarioName !== undefined && cliScenarioId !== undefined && (
        <ScenarioCliHelp scenarioName={cliScenarioName} scenarioId={cliScenarioId} />
      )}
      </div>
      </ScrollableElement>
    </div>
  )
}

export default ScenarioInspectorLegend
