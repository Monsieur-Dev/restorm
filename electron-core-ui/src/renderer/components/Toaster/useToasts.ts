import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { toasterService } from './ToasterService'
import type { Toast, ToastInput } from './types'

const EMPTY_TOASTS: Toast[] = []

function noopSubscribe(): () => void {
  return () => { /* no toasterId bound → no subscription */ }
}

function resolveId(defaultId: string | undefined, passed: string | undefined): string {
  const id = passed ?? defaultId
  if (!id) {
    throw new Error('[useToasts] A toasterId must be passed either to the hook or to the individual call.')
  }
  return id
}

/**
 * React hook for interacting with a `<Toaster>`. Optionally pre-bind
 * a `toasterId` so callers can omit it on every call. All methods also
 * accept an explicit `toasterId` to override the bound one.
 *
 * The getters returned (`toasts`, `showFrame`, `doNotDisturb`) only
 * reflect the toaster matching the *bound* id. For a multi-toaster
 * consumer, call the hook once per toaster.
 */
export function useToasts(toasterId?: string): {
  pushToast: (input: ToastInput, toasterIdOverride?: string) => string
  dismissToast: (toastId: string, toasterIdOverride?: string) => void
  clearToasts: (toasterIdOverride?: string) => void
  setDoNotDisturb: (enabled: boolean, toasterIdOverride?: string) => void
  toggleDoNotDisturb: (toasterIdOverride?: string) => void
  setShowFrame: (show: boolean, toasterIdOverride?: string) => void
  toggleShowFrame: (toasterIdOverride?: string) => void
  /** Live list of toasts for the bound toaster (empty when id is unset). */
  toasts: Toast[]
  /** Live `showFrame` flag for the bound toaster. */
  showFrame: boolean
  /** Live `doNotDisturb` flag for the bound toaster. */
  doNotDisturb: boolean
} {
  const boundIdRef = useRef(toasterId)
  useEffect(() => { boundIdRef.current = toasterId }, [toasterId])

  const pushToast = useCallback((input: ToastInput, toasterIdOverride?: string) => {
    return toasterService.push(resolveId(boundIdRef.current, toasterIdOverride), input)
  }, [])

  const dismissToast = useCallback((toastId: string, toasterIdOverride?: string) => {
    toasterService.dismiss(resolveId(boundIdRef.current, toasterIdOverride), toastId)
  }, [])

  const clearToasts = useCallback((toasterIdOverride?: string) => {
    toasterService.clear(resolveId(boundIdRef.current, toasterIdOverride))
  }, [])

  const setDoNotDisturb = useCallback((enabled: boolean, toasterIdOverride?: string) => {
    toasterService.setDoNotDisturb(resolveId(boundIdRef.current, toasterIdOverride), enabled)
  }, [])

  const toggleDoNotDisturb = useCallback((toasterIdOverride?: string) => {
    toasterService.toggleDoNotDisturb(resolveId(boundIdRef.current, toasterIdOverride))
  }, [])

  const setShowFrame = useCallback((show: boolean, toasterIdOverride?: string) => {
    toasterService.setShowFrame(resolveId(boundIdRef.current, toasterIdOverride), show)
  }, [])

  const toggleShowFrame = useCallback((toasterIdOverride?: string) => {
    toasterService.toggleShowFrame(resolveId(boundIdRef.current, toasterIdOverride))
  }, [])

  // ── Reactive getters ──────────────────────────────────────────────
  const subscribeToasts = useCallback((onStoreChange: () => void) => {
    if (!toasterId) return noopSubscribe()
    return toasterService.on('toastsChange', (id) => { if (id === toasterId) onStoreChange() })
  }, [toasterId])
  const toasts = useSyncExternalStore<Toast[]>(
    subscribeToasts,
    () => toasterId ? toasterService.getToasts(toasterId) : EMPTY_TOASTS
  )

  const subscribeShowFrame = useCallback((onStoreChange: () => void) => {
    if (!toasterId) return noopSubscribe()
    return toasterService.on('showFrameChange', (id) => { if (id === toasterId) onStoreChange() })
  }, [toasterId])
  const showFrame = useSyncExternalStore<boolean>(
    subscribeShowFrame,
    () => toasterId ? toasterService.getShowFrame(toasterId) : false
  )

  const subscribeDnd = useCallback((onStoreChange: () => void) => {
    if (!toasterId) return noopSubscribe()
    return toasterService.on('doNotDisturbChange', (id) => { if (id === toasterId) onStoreChange() })
  }, [toasterId])
  const doNotDisturb = useSyncExternalStore<boolean>(
    subscribeDnd,
    () => toasterId ? toasterService.getDoNotDisturb(toasterId) : false
  )

  return {
    pushToast,
    dismissToast,
    clearToasts,
    setDoNotDisturb,
    toggleDoNotDisturb,
    setShowFrame,
    toggleShowFrame,
    toasts,
    showFrame,
    doNotDisturb
  }
}
