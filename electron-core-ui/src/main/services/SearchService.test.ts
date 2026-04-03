import { describe, it, expect, beforeEach } from 'vitest'

// SearchService has no electron or fs dependencies — import directly
import { searchService } from './SearchService'
import type { SearchDocument, CategoryMeta } from './SearchService'

describe('SearchService', () => {
  beforeEach(() => {
    searchService.clearIndex()
  })

  // ---------------------------------------------------------------
  // Register categories
  // ---------------------------------------------------------------
  describe('registerCategory', () => {
    it('registers a single category', () => {
      searchService.registerCategory('routes', { label: 'Routes', icon: 'globe', order: 1 })

      const doc: SearchDocument = { id: '1', title: 'GET /users', category: 'routes' }
      searchService.indexDocument(doc)

      const results = searchService.search('users')
      expect(results).toHaveLength(1)
      expect(results[0]?.label).toBe('Routes')
      expect(results[0]?.icon).toBe('globe')
    })

    it('registers multiple categories at once', () => {
      const categories: Record<string, CategoryMeta> = {
        routes: { label: 'Routes', icon: 'globe', order: 1 },
        models: { label: 'Models', icon: 'database', order: 2 }
      }
      searchService.registerCategories(categories)

      searchService.indexDocument({ id: '1', title: 'User model', category: 'models' })
      const results = searchService.search('User')
      expect(results[0]?.label).toBe('Models')
    })
  })

  // ---------------------------------------------------------------
  // Index and search documents
  // ---------------------------------------------------------------
  describe('indexDocument and search', () => {
    it('indexes a document and finds it by title', () => {
      const doc: SearchDocument = { id: 'doc1', title: 'Authentication Service', category: 'services' }
      searchService.indexDocument(doc)

      const results = searchService.search('Authentication')
      expect(results).toHaveLength(1)
      expect(results[0]?.items).toHaveLength(1)
      expect(results[0]?.items[0]?.id).toBe('doc1')
    })

    it('indexes a document and finds it by description', () => {
      const doc: SearchDocument = {
        id: 'doc2',
        title: 'AuthService',
        description: 'Handles user authentication and JWT tokens',
        category: 'services'
      }
      searchService.indexDocument(doc)

      const results = searchService.search('JWT')
      expect(results).toHaveLength(1)
      expect(results[0]?.items[0]?.id).toBe('doc2')
    })

    it('indexes a document and finds it by keywords', () => {
      const doc: SearchDocument = {
        id: 'doc3',
        title: 'Login',
        keywords: 'oauth sso saml',
        category: 'endpoints'
      }
      searchService.indexDocument(doc)

      const results = searchService.search('oauth')
      expect(results).toHaveLength(1)
      expect(results[0]?.items[0]?.id).toBe('doc3')
    })

    it('returns empty results for empty query', () => {
      searchService.indexDocument({ id: '1', title: 'Test', category: 'a' })
      expect(searchService.search('')).toEqual([])
      expect(searchService.search('   ')).toEqual([])
    })

    it('returns empty results for no match', () => {
      searchService.indexDocument({ id: '1', title: 'Apples', category: 'fruit' })
      const results = searchService.search('zzzznotfound')
      expect(results).toEqual([])
    })

    it('re-indexes a document with the same id', () => {
      searchService.indexDocument({ id: 'dup', title: 'Original', category: 'a' })
      searchService.indexDocument({ id: 'dup', title: 'Updated', category: 'a' })

      expect(searchService.getDocumentCount()).toBe(1)
      const results = searchService.search('Updated')
      expect(results[0]?.items[0]?.id).toBe('dup')
    })
  })

  // ---------------------------------------------------------------
  // Remove documents
  // ---------------------------------------------------------------
  describe('removeDocument', () => {
    it('removes a document from the index', () => {
      searchService.indexDocument({ id: 'rm1', title: 'ToRemove', category: 'a' })
      expect(searchService.getDocumentCount()).toBe(1)

      searchService.removeDocument('rm1')
      expect(searchService.getDocumentCount()).toBe(0)

      const results = searchService.search('ToRemove')
      expect(results).toEqual([])
    })

    it('does nothing when removing a non-existent document', () => {
      searchService.removeDocument('nonexistent')
      expect(searchService.getDocumentCount()).toBe(0)
    })
  })

  // ---------------------------------------------------------------
  // Clear index
  // ---------------------------------------------------------------
  describe('clearIndex', () => {
    it('removes all documents', () => {
      searchService.indexDocument({ id: '1', title: 'One', category: 'a' })
      searchService.indexDocument({ id: '2', title: 'Two', category: 'b' })
      expect(searchService.getDocumentCount()).toBe(2)

      searchService.clearIndex()
      expect(searchService.getDocumentCount()).toBe(0)
    })
  })

  // ---------------------------------------------------------------
  // Search ranking: title match > description match
  // ---------------------------------------------------------------
  describe('search ranking', () => {
    it('ranks title matches higher than description matches', () => {
      searchService.indexDocument({
        id: 'title-match',
        title: 'Authentication',
        description: 'Some service',
        category: 'services'
      })
      searchService.indexDocument({
        id: 'desc-match',
        title: 'Security Service',
        description: 'Handles authentication flows',
        category: 'services'
      })

      const results = searchService.search('Authentication')
      const items = results.flatMap((g) => g.items)

      // The title-match document should appear first (higher score)
      expect(items.length).toBeGreaterThanOrEqual(2)
      const titleItem = items.find((i) => i.id === 'title-match')
      const descItem = items.find((i) => i.id === 'desc-match')
      if (!titleItem || !descItem) {
        expect.fail('Expected both title-match and desc-match items to be present')
      }
      expect(titleItem.score).toBeGreaterThan(descItem.score)
    })
  })

  // ---------------------------------------------------------------
  // Grouped results ordering
  // ---------------------------------------------------------------
  describe('grouped results', () => {
    it('sorts groups by category order', () => {
      searchService.registerCategory('second', { label: 'Second', icon: 'b', order: 2 })
      searchService.registerCategory('first', { label: 'First', icon: 'a', order: 1 })

      searchService.indexDocument({ id: '1', title: 'SearchTerm', category: 'second' })
      searchService.indexDocument({ id: '2', title: 'SearchTerm', category: 'first' })

      const results = searchService.search('SearchTerm')
      expect(results).toHaveLength(2)
      expect(results[0]?.category).toBe('first')
      expect(results[1]?.category).toBe('second')
    })

    it('uses default category meta for unregistered categories', () => {
      searchService.indexDocument({ id: '1', title: 'Unknown Category', category: 'mystery' })

      const results = searchService.search('Unknown')
      expect(results).toHaveLength(1)
      expect(results[0]?.label).toBe('Other')
      expect(results[0]?.icon).toBe('symbol-misc')
    })
  })
})
