import { useSyncExternalStore } from 'react'
import { getActiveDesignEntity, subscribeActiveDesignEntity, type ActiveDesignEntity } from '../services/designSectionIntent'

/**
 * Live "which entity (model / enum / route) the design tab has selected" for a
 * given design — the breadcrumb uses it to add the trailing entity segment.
 * `undefined` when the tab shows a section listing (no entity selected).
 */
export function useActiveDesignEntity(designId: string | undefined): ActiveDesignEntity | undefined {
  return useSyncExternalStore(
    (onChange) => subscribeActiveDesignEntity((id) => { if (id === designId) onChange() }),
    () => (designId !== undefined ? getActiveDesignEntity(designId) : undefined)
  )
}
