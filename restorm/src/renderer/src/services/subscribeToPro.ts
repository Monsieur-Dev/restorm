import { i18n, logger, toasterService } from 'electron-core-ui/renderer'

/** Surface a checkout outcome to the user via the app toaster. */
function toast(title: string): void {
  toasterService.push('app', { title, body: '', durationMs: 8000, ariaLive: 'assertive' })
}

/**
 * Drive the « S'abonner » upsell from a gated control.
 *
 * Subscribing requires a signed-in account (the backend resolves the customer
 * from the session), so this prompts login first when needed — gracefully: a
 * cancelled / failed login just aborts without opening anything. Once signed in
 * it asks the main process to create the checkout transaction and open the
 * returned Paddle URL in the SYSTEM browser (`account.subscribe()` →
 * `shell.openExternal`); the renderer never sees the URL or any token.
 *
 * Checkout is org-admin-only on the backend, so a non-admin gets a clear,
 * actionable toast (ask your org admin) rather than a silent failure; any other
 * backend / network failure surfaces a generic error toast.
 */
export async function subscribeToPro(): Promise<void> {
  const account = window.api.account
  try {
    let state = await account.getState()
    if (!state.signedIn) {
      // Prompt login first; the loopback flow returns the post-login state.
      state = await account.login()
      if (!state.signedIn) return
    }
    const result = await account.subscribe()
    switch (result.status) {
      case 'forbidden':
        toast(i18n.t(
          'subscription.checkout.forbidden',
          "Demandez à l'administrateur de votre organisation de s'abonner."
        ))
        break
      case 'error':
        toast(i18n.t(
          'subscription.checkout.error',
          "Impossible de démarrer l'abonnement. Veuillez réessayer."
        ))
        break
      case 'opened':
      case 'not-signed-in':
        // 'opened' → the system browser took over; 'not-signed-in' → a rare
        // race after login, nothing actionable to show.
        break
    }
  } catch (err) {
    logger.warn('subscribeToPro: checkout flow failed', {
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
