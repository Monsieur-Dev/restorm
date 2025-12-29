/**
 * SearchService - Client-side wrapper for the main process SearchService
 *
 * Provides the same API as the original SearchService but delegates
 * all operations to the main process via IPC.
 */

/** Navigation data for navigating to a search result (application-specific) */
export type SearchNavigation = Record<string, unknown>

/** Document to be indexed for search */
export interface SearchDocument {
  /** Unique identifier */
  id: string
  /** Display title */
  title: string
  /** Optional description/documentation */
  description?: string
  /** Category for grouping results */
  category: string
  /** Icon identifier (codicon name or method name) */
  icon?: string
  /** Additional keywords for search (tags, params, headers...) */
  keywords?: string
  /** Navigation data for clicking on the result */
  navigation?: SearchNavigation
  /** Additional metadata for the document (application-specific data) */
  metadata?: Record<string, unknown>
}

/** Search result with relevance score */
export interface SearchResult extends SearchDocument {
  score: number
}

/** Grouped search results by category */
export interface GroupedResults {
  category: string
  label: string
  icon: string
  items: SearchResult[]
}

/** Category metadata for display */
export interface CategoryMeta {
  label: string
  icon: string
  order: number
}

/**
 * SearchService client - delegates all operations to main process via IPC
 */
class SearchServiceClient {
  /**
   * Register a category with its metadata
   */
  async registerCategory(category: string, meta: CategoryMeta): Promise<void> {
    await window.api.search.registerCategories({ [category]: meta })
}

/**
   * Register multiple categories at once
   */
  async registerCategories(categories: Record<string, CategoryMeta>): Promise<void> {
    await window.api.search.registerCategories(categories)
  }

  /**
   * Index a single document
   */
  async indexDocument(doc: SearchDocument): Promise<void> {
    await window.api.search.indexDocument(doc)
  }

  /**
   * Index multiple documents at once
   */
  async indexDocuments(docs: SearchDocument[]): Promise<void> {
    await window.api.search.indexDocuments(docs)
  }

  /**
   * Remove a document from the index
   */
  async removeDocument(id: string): Promise<void> {
    await window.api.search.removeDocument(id)
  }

  /**
   * Clear the entire index
   */
  async clearIndex(): Promise<void> {
    await window.api.search.clearIndex()
  }

  /**
   * Search for documents and return results grouped by category
   */
  async search(query: string): Promise<GroupedResults[]> {
    return await window.api.search.search(query)
  }

  /**
   * Get total number of indexed documents
   */
  async getDocumentCount(): Promise<number> {
    return await window.api.search.getDocumentCount()
  }
}

/** Singleton instance of the search service client */
export const searchService = new SearchServiceClient()
