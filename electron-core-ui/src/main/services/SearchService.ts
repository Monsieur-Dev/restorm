/**
 * SearchService - Full-text search service using MiniSearch (Main Process)
 *
 * Provides document indexing, searching, and result grouping by category.
 * Runs in the main process to avoid blocking the UI.
 */

import MiniSearch from 'minisearch'
import { logger } from './LoggerService'

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

/** Default category for unknown categories */
const DEFAULT_CATEGORY_META: CategoryMeta = {
  label: 'Other',
  icon: 'symbol-misc',
  order: 99
}

/**
 * SearchService class providing full-text search capabilities
 */
class SearchServiceImpl {
  private miniSearch: MiniSearch<SearchDocument>
  private documents: Map<string, SearchDocument>
  private categoryMeta: Record<string, CategoryMeta> = {}

  constructor() {
    this.documents = new Map()
    this.miniSearch = new MiniSearch<SearchDocument>({
      fields: ['title', 'description', 'keywords'],
      storeFields: ['id', 'title', 'description', 'category', 'icon', 'keywords', 'navigation', 'metadata'],
      searchOptions: {
        boost: { title: 2 },
        fuzzy: 0.2,
        prefix: true
      }
    })
  }

  /**
   * Register a category with its metadata
   */
  registerCategory(category: string, meta: CategoryMeta): void {
    this.categoryMeta[category] = meta
    logger.debug('[SearchService] Category registered', { category, meta })
  }

  /**
   * Register multiple categories at once
   */
  registerCategories(categories: Record<string, CategoryMeta>): void {
    for (const [category, meta] of Object.entries(categories)) {
      this.categoryMeta[category] = meta
    }
    logger.debug('[SearchService] Categories registered', { count: Object.keys(categories).length })
  }

  /**
   * Index a single document
   */
  indexDocument(doc: SearchDocument): void {
    // Remove existing document with same id if exists
    const isReindex = this.documents.has(doc.id)
    if (isReindex) {
      this.removeDocument(doc.id)
    }

    this.documents.set(doc.id, doc)
    this.miniSearch.add(doc)
    logger.debug('[SearchService] Document indexed', { id: doc.id, title: doc.title, isReindex })
  }

  /**
   * Index multiple documents at once
   */
  indexDocuments(docs: SearchDocument[]): void {
    for (const doc of docs) {
      this.indexDocument(doc)
    }
    logger.debug('[SearchService] Batch indexed', { count: docs.length })
  }

  /**
   * Remove a document from the index
   */
  removeDocument(id: string): void {
    const doc = this.documents.get(id)
    if (doc) {
      this.miniSearch.remove(doc)
      this.documents.delete(id)
      logger.debug('[SearchService] Document removed', { id })
    }
  }

  /**
   * Clear the entire index
   */
  clearIndex(): void {
    this.documents.clear()
    this.miniSearch = new MiniSearch<SearchDocument>({
      fields: ['title', 'description', 'keywords'],
      storeFields: ['id', 'title', 'description', 'category', 'icon', 'keywords', 'navigation', 'metadata'],
      searchOptions: {
        boost: { title: 2 },
        fuzzy: 0.2,
        prefix: true
      }
    })
    logger.debug('[SearchService] Index cleared')
  }

  /**
   * Search for documents and return results grouped by category
   */
  search(query: string): GroupedResults[] {
    if (!query.trim()) {
      return []
    }

    const results = this.miniSearch.search(query)

    // Convert to SearchResult with full document data
    const searchResults: SearchResult[] = results.map((result) => {
      const doc = this.documents.get(result.id as string)
      const searchResult: SearchResult = {
        id: result.id as string,
        title: doc?.title ?? String(result.id),
        category: doc?.category ?? 'other',
        score: result.score
      }
      if (doc?.description) searchResult.description = doc.description
      if (doc?.icon) searchResult.icon = doc.icon
      if (doc?.keywords) searchResult.keywords = doc.keywords
      if (doc?.navigation) searchResult.navigation = doc.navigation
      if (doc?.metadata) searchResult.metadata = doc.metadata
      return searchResult
    })

    // Group by category
    const grouped = new Map<string, SearchResult[]>()

    for (const result of searchResults) {
      const category = result.category
      const categoryResults = grouped.get(category)
      if (categoryResults) {
        categoryResults.push(result)
      } else {
        grouped.set(category, [result])
      }
    }

    // Convert to GroupedResults array and sort by category order
    const groupedResults: GroupedResults[] = []

    for (const [category, items] of grouped) {
      const meta = this.categoryMeta[category] ?? DEFAULT_CATEGORY_META
      groupedResults.push({
        category,
        label: meta.label,
        icon: meta.icon,
        items
      })
    }

    // Sort groups by order
    groupedResults.sort((a, b) => {
      const orderA = this.categoryMeta[a.category]?.order ?? DEFAULT_CATEGORY_META.order
      const orderB = this.categoryMeta[b.category]?.order ?? DEFAULT_CATEGORY_META.order
      return orderA - orderB
    })

    logger.debug('[SearchService] Search completed', { query, resultCount: searchResults.length, groupCount: groupedResults.length })
    return groupedResults
  }

  /**
   * Get total number of indexed documents
   */
  getDocumentCount(): number {
    return this.documents.size
  }
}

/** Singleton instance of the search service */
export const searchService = new SearchServiceImpl()
