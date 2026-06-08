import { useEffect, useMemo } from 'react'
import type { FolderItem } from '../../../shared/types/collections'
import type { FirewallOrigin } from '../../../shared/types/firewall'
import { collectProjectOrigins } from '../../../shared/firewall/collectProjectOrigins'

interface FirewallProjectApi {
	setProjectOrigins: (origins: FirewallOrigin[]) => Promise<void>
}

function getFirewallApi(): FirewallProjectApi | null {
	const api = (window as unknown as { api?: { firewall?: FirewallProjectApi } }).api?.firewall
	return api ?? null
}

/**
 * Walk the project tree, collect every request's URL, resolve
 * any `{{var}}` references against the available environments,
 * extract the `(scheme, host, port)` triple, and push the deduped
 * set to main via `window.api.firewall.setProjectOrigins`.
 *
 * The main-process `PermissionService` uses this set as one of
 * its three "known destination" sources — meaning a fresh
 * `run_request` against a project URL doesn't trigger a toast as
 * long as at least one environment resolves the URL to a valid
 * origin.
 *
 * Substitution is a simple `{{key}}` → value pass; full
 * Handlebars (helpers, partials, conditionals) isn't supported —
 * the firewall only needs origin metadata, not the full URL. If
 * the URL still has unresolved variables after substitution, we
 * skip it (can't infer an origin from a parametric host).
 */
export function useFirewallProjectOriginsSync(rootItems: FolderItem[]): void {
	const origins = useMemo<FirewallOrigin[]>(() => collectProjectOrigins(rootItems), [rootItems])
	useEffect(() => {
		const api = getFirewallApi()
		if (api === null) return
		void api.setProjectOrigins(origins)
	}, [origins])
}
