import { ipcMain } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import {
  searchRegisterCategoriesArgs, searchIndexDocumentArgs, searchIndexDocumentsArgs,
  searchRemoveDocumentArgs, searchQueryArgs
} from '../../ipc/schemas'
import { searchService, type SearchDocument } from '../../services'

export function registerSearchHandlers(): void {
  // The args are already Zod-validated against searchDocumentSchema (the single
  // source of truth for the shape). The casts below only bridge Zod's inferred
  // `field?: T | undefined` optionals to the interface's exact `field?: T` under
  // exactOptionalPropertyTypes — they assert nothing the schema didn't check.
  validatedHandle('search:register-categories', searchRegisterCategoriesArgs, (_event, [categories]) => {
    searchService.registerCategories(categories)
    return true
  })

  validatedHandle('search:index-document', searchIndexDocumentArgs, (_event, [doc]) => {
    searchService.indexDocument(doc as SearchDocument)
    return true
  })

  validatedHandle('search:index-documents', searchIndexDocumentsArgs, (_event, [docs]) => {
    searchService.indexDocuments(docs as SearchDocument[])
    return true
  })

  validatedHandle('search:remove-document', searchRemoveDocumentArgs, (_event, [id]) => {
    searchService.removeDocument(id)
    return true
  })

  ipcMain.handle('search:clear-index', () => {
    searchService.clearIndex()
    return true
  })

  validatedHandle('search:search', searchQueryArgs, (_event, [query]) => {
    return searchService.search(query)
  })

  ipcMain.handle('search:get-document-count', () => {
    return searchService.getDocumentCount()
  })
}
