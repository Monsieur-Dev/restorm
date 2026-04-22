/**
 * Shared payload-builder for `window.restorm.auth.prefetch`. Used
 * both by the inline Send button in LocalAuthenticationRequestForm
 * and by AuthenticationSetupModal's "Save & retry import" action,
 * so the two code paths can never drift on body serialization or
 * header forwarding.
 *
 * Body type normalization: the class-level union is camelCase
 * (`formData` / `xWwwFormUrlEncoded`) but the UI actually stores
 * the kebab-case HTTP names verbatim (`form-data` /
 * `x-www-form-urlencoded`). We accept both so the helper works
 * regardless of which form is on disk, and emit kebab-case on the
 * wire so the main-side serializer can set Content-Type directly.
 */

import type { AuthenticationRequest } from '../../../../shared/types/collections'

type PrefetchPayload = Parameters<NonNullable<typeof window.restorm>['auth']['prefetch']>[0]

interface LooseBody {
  type?: string
  content?: string
  fields?: readonly { key: string; value: { toString(): string }; enabled?: boolean }[]
}

export function buildAuthPrefetchPayload(request: AuthenticationRequest): PrefetchPayload {
  // The body slot on the `shared/types` request is a discriminated
  // union. We branch on a normalized string for kebab-vs-camelCase
  // tolerance, which defeats TS's narrowing of the union — cast
  // through a loose view so field access is type-safe.
  const body = request.body as LooseBody | undefined
  const rawBodyType = body?.type
  let bodyPayload: PrefetchPayload['body']
  if (rawBodyType === 'text' && body?.content) {
    bodyPayload = { type: 'text', content: body.content }
  } else if (
    (rawBodyType === 'x-www-form-urlencoded' || rawBodyType === 'xWwwFormUrlEncoded' ||
      rawBodyType === 'form-data' || rawBodyType === 'formData') &&
    body?.fields
  ) {
    const normalizedType =
      rawBodyType === 'x-www-form-urlencoded' || rawBodyType === 'xWwwFormUrlEncoded'
        ? 'x-www-form-urlencoded'
        : 'form-data'
    bodyPayload = {
      type: normalizedType,
      fields: body.fields.map((f) => serializeKv(f))
    }
  }

  return {
    method: request.method,
    url: request.url,
    headers: request.headers.map((h) => serializeKv(h)),
    producedHeaders: request.producedHeaders.map((h) => serializeKv(h)),
    ...(request.expirationExpression ? { expirationExpression: request.expirationExpression } : {}),
    ...(bodyPayload ? { body: bodyPayload } : {})
  }
}

// `exactOptionalPropertyTypes: true` forbids setting `enabled: undefined`
// on a slot typed `enabled?: boolean` — it has to be omitted. Build
// the entry in two steps so the `enabled` key is only present when
// actually known.
function serializeKv(kv: { key: string; value: { toString(): string }; enabled?: boolean | undefined }):
{ key: string; value: string; enabled?: boolean } {
  const out: { key: string; value: string; enabled?: boolean } = {
    key: kv.key,
    value: kv.value.toString()
  }
  if (kv.enabled !== undefined) out.enabled = kv.enabled
  return out
}
