import { useEffect, useRef } from 'react'

/**
 * Handles the request-switch reset pattern.
 *
 * When `request` changes identity (by `request.id`), the provided `onReset`
 * callback is scheduled inside a `requestAnimationFrame` so the component
 * renders once with stale state removed before being re-populated.
 *
 * The RAF is cancelled on cleanup to avoid updates after unmount.
 */
export function useRequestReset(request: { id: string }, onReset: () => void): void {
  const requestIdRef = useRef(request.id)

  useEffect(() => {
    if (requestIdRef.current !== request.id) {
      requestIdRef.current = request.id
      const rafId = requestAnimationFrame(() => {
        onReset()
      })
      return (): void => { cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [request, onReset])
}
