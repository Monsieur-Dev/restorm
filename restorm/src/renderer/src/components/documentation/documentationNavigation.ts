import { createContext, useContext } from 'react'

/**
 * Imperative scroll API exposed by `DocumentationHost` to its
 * descendants — sidebar, cross-reference links — so they can jump
 * to a route block or a model card without each component owning
 * its own DOM lookup.
 *
 * Both methods are no-ops when the target isn't currently rendered
 * (a model anchor inside a folder scope that doesn't reference it,
 * or an operation slug that doesn't match any route block).
 */
export interface DocumentationNavigationApi {
  /** Scroll back to the top of the host — the scope header (env
   * folder / folder docs) or the first route block when there is
   * no header. Used by the sidebar's "Overview" link. */
  scrollToTop: () => void
  /** Scroll the matching route block into view. `slug` matches the
   * `id="docop-${slug}"` attribute the host stamps on each block. */
  scrollToOperation: (slug: string) => void
  /** Scroll the Models section into view AND pan the React Flow
   * canvas to the named model. */
  scrollToModel: (name: string) => void
  /** Scroll the Enums section into view, optionally highlighting
   * the entry for `modelName` (or a specific property when
   * `propertyName` is supplied). */
  scrollToEnum: (modelName: string, propertyName?: string) => void
  /** Scroll the Operations section into view — i.e. the first
   * per-tag group header rendered under the scope title. Falls
   * back to the first route block when the host is not running
   * in grouped layout. */
  scrollToOperations: () => void
}

export const DocumentationNavigationContext =
  createContext<DocumentationNavigationApi | undefined>(undefined)

export function useDocumentationNavigation(): DocumentationNavigationApi | undefined {
  return useContext(DocumentationNavigationContext)
}
