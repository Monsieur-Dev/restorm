/**
 * Quick-config selector section for a request-binding scenario action.
 *
 * A request / send / connect / listen node bound to a saved request can pick a
 * saved quick-config (TASK-66.25) as its base: the action runs the request with
 * that config's fields applied (resolved by id from the .restorm file). The
 * request itself is edited only in the normal request editor — the scenario
 * action just chooses a saved config; it does not override individual fields.
 */

import { useEffect, useState } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import type { Request } from '../../../../../shared/types/collections'
import type { ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { getProjectConfigs } from '../../../services/requestQuickConfigStore'
import { DocumentEvents } from '../../../services/DocumentEvents'
import { QuickConfigSelectorRow } from './QuickConfigSelectorRow'

/** The quick-config selector section (a chooser, not a port). */
function buildSelectorSection(
  request: Request,
  config: Record<string, unknown>,
  onSetConfig: (patch: Record<string, unknown>) => void
): ScenarioNodeSection {
  return {
    id: 'quick-config',
    rows: [{
      id: 'quick-config',
      content: <QuickConfigSelectorRow request={request} config={config} onSetConfig={onSetConfig} />
    }]
  }
}

/**
 * Hook: the quick-config selector section for a request/send/connect/listen
 * action box. Returns NULL when the bound request has no file/project config —
 * so the box reserves NO row at all (an empty selector row would waste space).
 * Subscribes to the request document events so the section appears/disappears
 * LIVE as configs are added or removed (the request's `quickConfigs` array
 * mutates in place — object identity never changes — so the explicit bump is
 * what re-reads the list and toggles the row).
 */
export function useSelectorSection(
  request: Request | null,
  config: Record<string, unknown>,
  onSetConfig: (patch: Record<string, unknown>) => void
): ScenarioNodeSection | null {
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = (): void => { setTick((n) => n + 1) }
    const subs = [
      eventBus.subscribe(DocumentEvents.REQUEST_UPDATED, bump),
      eventBus.subscribe(DocumentEvents.REQUEST_CREATED, bump),
      eventBus.subscribe(DocumentEvents.REQUEST_DELETED, bump)
    ]
    return () => { subs.forEach((s) => { s.unsubscribe() }) }
  }, [])

  if (!request || getProjectConfigs(request).length === 0) return null
  return buildSelectorSection(request, config, onSetConfig)
}

/**
 * Hook: the quick-config selector section(s) for a STREAMING connect /
 * mock-server listen box. Returns [] when there is nothing to show.
 */
export function useStreamingOverrideSections(
  request: Request | null,
  config: Record<string, unknown>,
  onSetConfig: (patch: Record<string, unknown>) => void
): ScenarioNodeSection[] {
  const selector = useSelectorSection(request, config, onSetConfig)
  return selector ? [selector] : []
}
