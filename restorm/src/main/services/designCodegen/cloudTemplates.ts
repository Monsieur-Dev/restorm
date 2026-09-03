/**
 * Cloud codegen-template client (main process).
 *
 * Reads and mutates the org's codegen templates through the `templates` Edge
 * Function, reusing the entitlement service's authenticated, firewall-bypassed
 * POST (`postWithSession`) so the session JWT never crosses the IPC bridge. The
 * official templates are curated in the cloud repo, so this client only ever
 * lists them and create/delete the caller ORG's own.
 *
 * `postWithSession` resolves `null` when the user is signed out (the caller
 * surfaces a sign-in prompt) and throws `SessionCallError` on a non-2xx (e.g.
 * `plan_required` / `forbidden`), which the library shows as an error state.
 */

import {
  getEntitlementService,
  resolveBackendVersion,
} from '../auth/authComposition'
import { endpointUrl, resolveChannel } from '../../../shared/config/backend'
import type {
  CloudTemplate,
  CloudTemplatesView,
} from '../../../shared/types/codegenTemplates'

function templatesUrl(): string {
  return endpointUrl(resolveChannel(resolveBackendVersion()), 'templates')
}

/** Official + the caller org's own templates. `null` when signed out. */
export function listCloudTemplates(): Promise<CloudTemplatesView | null> {
  return getEntitlementService().postWithSession<CloudTemplatesView>(
    templatesUrl(),
    { action: 'list' }
  )
}

/** Add a template to the caller's org. `null` when signed out; throws on a
 * server refusal (`plan_required`, `forbidden`, `duplicate`, …). */
export async function createCloudTemplate(
  url: string,
  description: string
): Promise<CloudTemplate | null> {
  const out = await getEntitlementService().postWithSession<{
    template: CloudTemplate
  }>(templatesUrl(), { action: 'create', url, description })
  return out?.template ?? null
}

/** Remove one of the caller org's templates (never an official one). `null`
 * when signed out; throws on a server refusal. */
export function deleteCloudTemplate(id: string): Promise<{ ok: boolean } | null> {
  return getEntitlementService().postWithSession<{ ok: boolean }>(
    templatesUrl(),
    { action: 'delete', id }
  )
}
