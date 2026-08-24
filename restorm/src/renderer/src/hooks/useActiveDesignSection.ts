import { useSyncExternalStore } from 'react'
import type { DesignSectionKey } from '../../../shared/types/editor'
import { getActiveDesignSection, subscribeActiveDesignSection } from '../services/designSectionIntent'

/**
 * Live "which section is the design tab showing" for a given design — the
 * breadcrumb uses it to keep its trailing section segment in sync as the
 * user navigates between sections. `undefined` until the tab publishes.
 */
export function useActiveDesignSection(designId: string | undefined): DesignSectionKey | undefined {
  return useSyncExternalStore(
    (onChange) => subscribeActiveDesignSection((id) => { if (id === designId) onChange() }),
    () => (designId !== undefined ? getActiveDesignSection(designId) : undefined)
  )
}
