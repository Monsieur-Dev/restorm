import { useEffect } from 'react'
import { useRestormStore } from '../store/restormStore'
import { extractScenarioActionSuggestions, type ScenarioActionSuggestion } from '../../../shared/utils/scenarioStaticPreview'
import { isScenario } from '../../../shared/types/folderTypes'
import type { FolderItem, Scenario } from '../../../shared/types/collections'

/** What the e2e automation hook returns per action: the data suggestion the
 * inspector shows before any run, plus where it came from. */
export interface ExtractedActionSuggestion extends ScenarioActionSuggestion {
  /** `static` = config-derived preview; `history` = last archived run result
   * (non-static kinds like `httpRequest` draw from the call-history zip). */
  source: 'static' | 'history'
}

interface SuggestionsBridge {
  /** Extract every action's inspector suggestion for the named scenario, or
   * `null` when no scenario by that name is loaded. */
  extract: (scenarioName: string) => Promise<ExtractedActionSuggestion[] | null>
}

interface RuntimeBridge {
  getScenarioNodeResult?: (scenarioId: string, nodeId: string) => Promise<Record<string, unknown> | null>
}

/** Depth-first search for a loaded scenario by name (folders + scenarios both
 * carry `items`; an env-folder root is folder-like too — walk by `items`, not
 * `isAnyFolder`, so the roots aren't skipped). */
function findScenarioByName(items: readonly FolderItem[], name: string): Scenario | null {
  for (const item of items) {
    if (isScenario(item) && item.name === name) return item
    const children = (item as { items?: FolderItem[] }).items
    if (Array.isArray(children)) {
      const found = findScenarioByName(children, name)
      if (found) return found
    }
  }
  return null
}

/**
 * Registers `window.__restormSuggestions` so an e2e test can pull, from the
 * RUNNING app, every action's inspector data suggestion for a scenario —
 * computed exactly as the inspector does: the config-derived static preview
 * wins when present, and a non-static kind (e.g. `httpRequest`) falls back to
 * its last archived run result (the call-history zip), via the runtime bridge.
 * Read-only; mounted once at the app root.
 */
export function useScenarioSuggestionsBridge(): void {
  useEffect(() => {
    const w = window as unknown as {
      __restormSuggestions?: SuggestionsBridge
      restorm?: { runtime?: RuntimeBridge }
    }
    const bridge: SuggestionsBridge = {
      extract: async (scenarioName) => {
        const collections = useRestormStore.getState().collections
        const scenario = findScenarioByName(collections, scenarioName)
        if (!scenario) return null
        const statics = extractScenarioActionSuggestions({ nodes: scenario.nodes, edges: scenario.edges })
        const getResult = w.restorm?.runtime?.getScenarioNodeResult
        return Promise.all(
          statics.map(async (s): Promise<ExtractedActionSuggestion> => {
            // Static preview wins when present (the inspector's rule).
            if (s.suggestion !== null || !getResult) return { ...s, source: 'static' }
            try {
              const res = await getResult(scenario.id, s.id)
              return res !== null ? { ...s, suggestion: res, source: 'history' } : { ...s, source: 'static' }
            } catch {
              return { ...s, source: 'static' }
            }
          })
        )
      }
    }
    w.__restormSuggestions = bridge
    return () => { if (w.__restormSuggestions === bridge) delete w.__restormSuggestions }
  }, [])
}
