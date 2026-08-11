/**
 * Far-left statusbar cell: `Restorm v<version> - <Plan>`.
 *
 * - Version comes from the main process via the `app:get-version` IPC
 *   (`app.getVersion()`), so the package.json `-preview` suffix rides preview
 *   builds for free — nothing channel-specific to compute here.
 * - Plan reflects the live cloud entitlement (`window.api.account`): we read
 *   the current state on mount and then track `onStateChanged` so login /
 *   logout / refresh repaint the badge. Before auth resolves (or when signed
 *   out) the badge shows the Community placeholder, so the slot always exists.
 *
 * Renders a shared ECUI `StatusbarElement` — the shared Statusbar component is
 * untouched; this is a restorm-side child.
 */

import React, { useEffect, useState } from 'react'
import { StatusbarElement } from 'electron-core-ui/renderer'
import type { PlanTier } from '../../../../shared/auth/authState'

/** Human-facing tier labels. Proper nouns — NOT translated (kept identical in
 * every locale, like the "Restorm" product name itself). */
const PLAN_LABELS: Record<PlanTier, string> = {
  community: 'Community',
  pro: 'Pro',
  enterprise: 'Enterprise'
}

export const StatusbarVersionPlan: React.FC = () => {
  const [version, setVersion] = useState<string | null>(null)
  // Default to the Community placeholder so the badge exists before the auth
  // state resolves and whenever the user is signed out.
  const [plan, setPlan] = useState<PlanTier>('community')

  // Fetch the app version once — it never changes for the window's lifetime.
  useEffect(() => {
    let cancelled = false
    void window.api.app.getVersion().then((v) => {
      if (!cancelled) setVersion(v)
    })
    return () => { cancelled = true }
  }, [])

  // Seed the current plan and subscribe to live entitlement changes
  // (login / logout / refresh). The unsubscribe detaches on unmount.
  useEffect(() => {
    let cancelled = false
    void window.api.account.getState().then((state) => {
      if (!cancelled) setPlan(state.plan)
    })
    const unsubscribe = window.api.account.onStateChanged((state) => {
      setPlan(state.plan)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const planLabel = PLAN_LABELS[plan]
  const title = `Restorm${version ? ` v${version}` : ''} - ${planLabel}`

  return <StatusbarElement title={title} data-testid="app-statusbar-version-plan" />
}
