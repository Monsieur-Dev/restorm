import { useContext } from 'react'
import { RequestCreationContext, type RequestCreationApi } from './requestCreationContextValue'

/**
 * Consumer-side hook. Returns `undefined` outside the provider so
 * the doc viewer can hide its Add buttons gracefully when rendered
 * in tests or detached previews where the creation pipeline isn't
 * available.
 */
export function useRequestCreation(): RequestCreationApi | undefined {
  return useContext(RequestCreationContext)
}
