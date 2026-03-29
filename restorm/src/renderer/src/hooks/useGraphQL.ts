/**
 * React hooks for GraphQL operations in Restorm
 * 
 * Provides easy-to-use hooks for common GraphQL operations with
 * loading states and error handling.
 */

import { useState, useCallback, useEffect } from 'react'
import { logger } from 'electron-core-ui/renderer'
import * as graphqlApi from '../services/GraphQLIntegration'
import type { EnvironmentFolder, FolderItem, Environment, Request, Folder } from '../../../shared/types/collections'

/**
 * Hook state for async operations
 */
interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

/**
 * Hook for fetching collections
 */
export function useCollections(): AsyncState<EnvironmentFolder[]> & {
  refetch: () => Promise<void>
} {
  const [state, setState] = useState<AsyncState<EnvironmentFolder[]>>({
    data: null,
    loading: false,
    error: null
  })

  const refetch = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const collections = await graphqlApi.fetchCollections()
      setState({ data: collections, loading: false, error: null })
    } catch (error) {
      logger.error('[useCollections] Failed to fetch', { error: String(error) })
      setState(prev => ({ ...prev, loading: false, error: error as Error }))
    }
  }, [])

  return { ...state, refetch }
}

/**
 * Hook for searching items
 */
export function useSearch(): {
  results: FolderItem[]
  loading: boolean
  error: Error | null
  search: (query: string, limit?: number) => Promise<void>
  clear: () => void
} {
  const [state, setState] = useState<AsyncState<FolderItem[]>>({
    data: [],
    loading: false,
    error: null
  })

  const search = useCallback(async (query: string, limit?: number) => {
    if (!query.trim()) {
      setState({ data: [], loading: false, error: null })
      return
    }

    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const results = await graphqlApi.searchItems(query, limit)
      setState({ data: results, loading: false, error: null })
    } catch (error) {
      logger.error('[useSearch] Failed to search', { error: String(error) })
      setState(prev => ({ ...prev, loading: false, error: error as Error }))
    }
  }, [])

  const clear = useCallback(() => {
    setState({ data: [], loading: false, error: null })
  }, [])

  return {
    results: state.data ?? [],
    loading: state.loading,
    error: state.error,
    search,
    clear
  }
}

/**
 * Hook for resolved context
 */
export function useResolvedContext(environmentId: string | null): AsyncState<{
  environmentId: string
  variables: { key: string; value: string; resolved: string }[]
}> & {
  refetch: () => Promise<void>
} {
  const [state, setState] = useState<AsyncState<{
    environmentId: string
    variables: { key: string; value: string; resolved: string }[]
  }>>({
    data: null,
    loading: false,
    error: null
  })

  const refetch = useCallback(async () => {
    if (!environmentId) {
      setState({ data: null, loading: false, error: null })
      return
    }

    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const context = await graphqlApi.getResolvedContext(environmentId)
      setState({ data: context, loading: false, error: null })
    } catch (error) {
      logger.error('[useResolvedContext] Failed to fetch', { error: String(error) })
      setState(prev => ({ ...prev, loading: false, error: error as Error }))
    }
  }, [environmentId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { ...state, refetch }
}

/**
 * Hook for resolved URL
 */
export function useResolvedURL(requestId: string | null, environmentId: string | null): AsyncState<{
  requestId: string
  environmentId: string
  original: string
  resolved: string
}> & {
  refetch: () => Promise<void>
} {
  const [state, setState] = useState<AsyncState<{
    requestId: string
    environmentId: string
    original: string
    resolved: string
  }>>({
    data: null,
    loading: false,
    error: null
  })

  const refetch = useCallback(async () => {
    if (!requestId || !environmentId) {
      setState({ data: null, loading: false, error: null })
      return
    }

    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const result = await graphqlApi.getResolvedURL(requestId, environmentId)
      setState({ data: result, loading: false, error: null })
    } catch (error) {
      logger.error('[useResolvedURL] Failed to fetch', { error: String(error) })
      setState(prev => ({ ...prev, loading: false, error: error as Error }))
    }
  }, [requestId, environmentId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { ...state, refetch }
}

/**
 * Hook for folder mutations
 */
export function useFolderMutations(): {
  createFolder: (parentId: string | null, input: { name: string; documentation?: string; tags?: string[] }) => Promise<Folder | null>
  updateFolder: (id: string, input: { name?: string; documentation?: string; tags?: string[] }) => Promise<Folder | null>
  deleteFolder: (id: string) => Promise<boolean>
  loading: boolean
  error: Error | null
} {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const createFolder = useCallback(async (
    parentId: string | null,
    input: { name: string; documentation?: string; tags?: string[] }
  ): Promise<Folder | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await graphqlApi.createFolder(parentId, input)
      return result
    } catch (err) {
      setError(err as Error)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const updateFolder = useCallback(async (
    id: string,
    input: { name?: string; documentation?: string; tags?: string[] }
  ): Promise<Folder | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await graphqlApi.updateFolder(id, input)
      return result
    } catch (err) {
      setError(err as Error)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteFolder = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      return await graphqlApi.deleteFolder(id)
    } catch (err) {
      setError(err as Error)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { createFolder, updateFolder, deleteFolder, loading, error }
}

/**
 * Hook for request mutations
 */
export function useRequestMutations(): {
  createRequest: (parentId: string, input: { name: string; type: string; method?: string; url?: string }) => Promise<Request | null>
  updateRequest: (id: string, input: { name?: string; method?: string; url?: string }) => Promise<Request | null>
  deleteRequest: (id: string) => Promise<boolean>
  loading: boolean
  error: Error | null
} {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const createRequest = useCallback(async (
    parentId: string,
    input: { name: string; type: string; method?: string; url?: string }
  ): Promise<Request | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await graphqlApi.createRequest(parentId, input)
      return result
    } catch (err) {
      setError(err as Error)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const updateRequest = useCallback(async (
    id: string,
    input: { name?: string; method?: string; url?: string }
  ): Promise<Request | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await graphqlApi.updateRequest(id, input)
      return result
    } catch (err) {
      setError(err as Error)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteRequest = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      return await graphqlApi.deleteRequest(id)
    } catch (err) {
      setError(err as Error)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { createRequest, updateRequest, deleteRequest, loading, error }
}

/**
 * Hook for environment mutations
 */
export function useEnvironmentMutations(): {
  createEnvironment: (
    parentId: string,
    input: { name: string; variables?: { key: string; value: string; description?: string; isSecret?: boolean }[] },
    parentEnvironmentId?: string
  ) => Promise<Environment | null>
  updateEnvironment: (
    id: string,
    input: { name?: string; variables?: { key: string; value: string; description?: string; isSecret?: boolean }[] }
  ) => Promise<Environment | null>
  deleteEnvironment: (id: string) => Promise<boolean>
  loading: boolean
  error: Error | null
} {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const createEnvironment = useCallback(async (
    parentId: string,
    input: { name: string; variables?: { key: string; value: string; description?: string; isSecret?: boolean }[] },
    parentEnvironmentId?: string
  ): Promise<Environment | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await graphqlApi.createEnvironment(parentId, input, parentEnvironmentId)
      return result
    } catch (err) {
      setError(err as Error)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const updateEnvironment = useCallback(async (
    id: string,
    input: { name?: string; variables?: { key: string; value: string; description?: string; isSecret?: boolean }[] }
  ): Promise<Environment | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await graphqlApi.updateEnvironment(id, input)
      return result
    } catch (err) {
      setError(err as Error)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteEnvironment = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      return await graphqlApi.deleteEnvironment(id)
    } catch (err) {
      setError(err as Error)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { createEnvironment, updateEnvironment, deleteEnvironment, loading, error }
}
