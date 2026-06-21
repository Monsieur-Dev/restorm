/**
 * Shared payload-builder for `window.restorm.auth.prefetch`. Used
 * both by the inline Send button in LocalAuthenticationRequestForm
 * and by AuthenticationSetupModal's "Save & retry import" action,
 * so the two code paths can never drift on body serialization or
 * header forwarding.
 *
 * `body.type` is the canonical kebab-case HTTP vocabulary
 * (`form-data` / `x-www-form-urlencoded`) end-to-end — on disk, in the
 * model, and on the wire — so the builder branches on the discriminated
 * union directly and the main-side serializer can set Content-Type from
 * the same value.
 */

import type { AuthenticationRequest } from '../../../../shared/types/collections'

type PrefetchPayload = Parameters<NonNullable<typeof window.restorm>['auth']['prefetch']>[0]

export function buildAuthPrefetchPayload(request: AuthenticationRequest): PrefetchPayload {
  const body = request.body
  let bodyPayload: PrefetchPayload['body']
  if (body?.type === 'text' && body.content) {
    bodyPayload = { type: 'text', content: body.content }
  } else if (body?.type === 'x-www-form-urlencoded' || body?.type === 'form-data') {
    bodyPayload = {
      type: body.type,
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
