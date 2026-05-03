/**
 * Wire shapes for restorm-domain MCP tool replies. Pinned in one
 * place so unit tests can assert against them without re-deriving
 * the field set from the implementation. Anything sent to the AI
 * client goes through `JSON.stringify` after these objects are
 * built; secrets (PasswordValue) are stripped one layer earlier in
 * `CollectionStore.serializeRequest` via the `@NonSerialised`
 * decorator + `toJSON` chain.
 */

export type FolderKind = 'folder' | 'env-folder'

export interface ListedFolder {
  id: string
  name: string
  kind: FolderKind
  parentId: string | null
}

export interface ListedRequest {
  id: string
  name: string
  protocol: string
  method?: string
  parentId: string | null
}

export interface CurrentTabInfo {
  tabId: string | null
  itemId: string | null
  kind: 'request' | 'folder' | 'env-folder' | null
}

export interface ResolvedEnvVariable {
  key: string
  /** Raw template value (Handlebars source). Never a PasswordValue plaintext. */
  value: string
  /** Value after Handlebars resolution. Same masking guarantee. */
  resolved: string
}

export interface ActiveEnvSnapshot {
  envFolderId: string
  selectedEnvId: string | null
  selectedEnvName: string | null
  variables: ResolvedEnvVariable[]
}
