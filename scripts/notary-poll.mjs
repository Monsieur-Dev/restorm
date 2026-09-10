#!/usr/bin/env node
// Poll the App Store Connect Notary API (v2) for one or more submission ids
// until each reaches a terminal state. Runs ANYWHERE — no macOS / notarytool
// needed — so the wait happens off the (10x-billed) macOS runner: authenticates
// with the standard App Store Connect JWT (ES256), same key as `notarytool`.
//
//   APPLE_API_KEY       path to the .p8 private key (PKCS#8 PEM)
//   APPLE_API_KEY_ID    the key id (JWT `kid`)
//   APPLE_API_ISSUER    the issuer id (JWT `iss`)
//   NOTARY_POLL_SECONDS interval between polls (default 60)
//   NOTARY_TIMEOUT_MINUTES overall cap (default 60)
//
// Usage: node notary-poll.mjs <submissionId> [<submissionId> ...]
// Exits 0 when every submission is Accepted; non-zero on Invalid/Rejected/timeout.
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const KEY_ID = process.env.APPLE_API_KEY_ID
const ISSUER = process.env.APPLE_API_ISSUER
const KEY_PATH = process.env.APPLE_API_KEY
const POLL_SECONDS = Number(process.env.NOTARY_POLL_SECONDS || 60)
const TIMEOUT_MINUTES = Number(process.env.NOTARY_TIMEOUT_MINUTES || 60)
const API = 'https://appstoreconnect.apple.com/notary/v2/submissions'

const ids = process.argv.slice(2).filter(Boolean)
if (ids.length === 0) {
  console.error('usage: notary-poll.mjs <submissionId> [<submissionId> ...]')
  process.exit(2)
}
if (!KEY_ID || !ISSUER || !KEY_PATH) {
  console.error('missing APPLE_API_KEY_ID / APPLE_API_ISSUER / APPLE_API_KEY')
  process.exit(2)
}

const privateKey = crypto.createPrivateKey(readFileSync(KEY_PATH, 'utf8'))
const b64url = (buf) => Buffer.from(buf).toString('base64url')

// A short-lived ES256 JWT, minted fresh per request so a long wait never
// outlives the token. `ieee-p1363` yields the raw R||S signature JOSE wants.
function mintJwt() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }),
  )
  const input = `${header}.${payload}`
  const sig = crypto.sign('sha256', Buffer.from(input), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${input}.${b64url(sig)}`
}

async function getStatus(id) {
  const res = await fetch(`${API}/${id}`, {
    headers: { Authorization: `Bearer ${mintJwt()}` },
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} polling ${id}: ${await res.text()}`)
  }
  const body = await res.json()
  return body?.data?.attributes?.status // In Progress | Accepted | Invalid | Rejected
}

async function fetchLog(id) {
  try {
    const res = await fetch(`${API}/${id}/logs`, {
      headers: { Authorization: `Bearer ${mintJwt()}` },
    })
    const url = (await res.json())?.data?.attributes?.developerLogUrl
    if (url) return await (await fetch(url)).text()
  } catch {
    /* best effort — the status already told us it failed */
  }
  return '(no notarization log available)'
}

const deadline = Date.now() + TIMEOUT_MINUTES * 60_000
const pending = new Set(ids)
while (pending.size > 0) {
  if (Date.now() > deadline) {
    console.error(
      `timeout after ${TIMEOUT_MINUTES}m; still pending: ${[...pending].join(', ')}`,
    )
    process.exit(1)
  }
  for (const id of [...pending]) {
    const status = await getStatus(id)
    console.log(`[${new Date().toISOString()}] ${id}: ${status}`)
    if (status === 'Accepted') {
      pending.delete(id)
    } else if (status === 'Invalid' || status === 'Rejected') {
      console.error(`submission ${id} ${status}. Notary log:\n${await fetchLog(id)}`)
      process.exit(1)
    }
  }
  if (pending.size > 0) await sleep(POLL_SECONDS * 1000)
}
console.log('All submissions Accepted.')
