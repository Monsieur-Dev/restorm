import { createContext } from 'react'
import type { OperationDocumentation, ModelDocumentation } from '../../../shared/types/apiDocumentation'

export interface CreateFromOperationOptions {
  /** Id of the env folder that owns the imported `apiDocumentation`.
   * The provider uses it to scope the tag-folder lookup so we don't
   * accidentally drop a request inside a sibling collection that
   * happens to carry a folder with the same name. */
  envFolderId: string
  /** Optional explicit target folder. When supplied, the request is
   * created inside that folder regardless of the operation's tag —
   * used by the folder Docs2 view where the user is already viewing
   * a specific folder. */
  parentFolderId?: string
  /** The `models` map from the same `ApiDocumentation` the operation
   * belongs to. Lets the builder reconstruct the request body from the
   * referenced request-body model, matching what a normal import produces.
   * Omitted → no body is generated (back-compat). */
  models?: Record<string, ModelDocumentation>
  /** The `{{name}}` base-URL prefix to prepend to the request path, resolved
   * from the env folder's root variables (the variable whose value matches the
   * API URL — not necessarily named `baseUrl`). Omitted → bare path, matching
   * an import that found no server to seed. */
  baseUrlPrefix?: string
}

export interface RequestCreationApi {
  /** Build a Request from the operation, ensure the target tag-folder
   * exists (creating it on demand under the env folder when missing),
   * mount the request in the reactive tree, open it in a new tab,
   * and return the new request id. */
  createFromOperation: (operation: OperationDocumentation, options: CreateFromOperationOptions) => string | undefined
}

export const RequestCreationContext = createContext<RequestCreationApi | undefined>(undefined)
