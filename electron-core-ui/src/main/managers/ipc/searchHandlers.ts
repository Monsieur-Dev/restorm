import { ipcMain } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import {
  searchRegisterCategoriesArgs, searchIndexDocumentArgs, searchIndexDocumentsArgs,
  searchRemoveDocumentArgs, searchQueryArgs
} from '../../ipc/schemas'
import { searchService, type SearchDocument, type CategoryMeta } from '../../services'

export function registerSearchHandlers(): void {
  validatedHandle('search:register-categories', searchRegisterCategoriesArgs, (_event, [categories]) => {
    searchService.registerCategories(categories as Record<string, CategoryMeta>)
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
