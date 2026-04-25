# Auth Test Service

Minimal ASP.NET Core 9 service used by the `auth-login` e2e suite to
exercise the authentication-cache pipeline end-to-end.

## Public endpoints (referenced from the sample collection)

| Route              | Method | Auth     | Logged | Purpose                                                                                                |
|--------------------|--------|----------|--------|--------------------------------------------------------------------------------------------------------|
| `/health`          | GET    | —        | No     | Liveness probe (used by `wait-for-services.js` + compose healthcheck)                                  |
| `/login`           | POST   | —        | Yes    | `{ "client_id": "VALID_CLIENT_ID" \| "INVALID_CLIENT_ID" }` → Bearer token or 401. **Gated.**          |
| `/releaselogins`   | GET    | —        | No     | Unblocks every login currently waiting on the gate; installs a fresh gate for the next batch          |
| `/pet/{id}`        | GET    | Bearer   | Yes    | Static pet payload — Bearer must be a token currently in the [token store](#token-store)              |
| `/swagger.json`    | GET    | Bearer   | Yes    | Pet-only OpenAPI 3.0 spec — same Bearer gate as `/pet/{id}`                                           |

## Test-only endpoints (called from the e2e via raw HTTP)

| Route           | Method | Purpose                                                                                |
|-----------------|--------|----------------------------------------------------------------------------------------|
| `/cleartokens`  | POST   | Empties the [token store](#token-store); previously-issued tokens start returning 401  |
| `/clear_logs`   | POST   | Empties the [log store](#log-store)                                                    |
| `/getlogs`      | GET    | Returns `{ "logs": [ "POST /login -> 200", "GET /pet/1 -> 200", … ] }`                 |

## Login behaviour

`POST /login` takes a minimal body — a single `client_id` — and behaves
differently based on the value:

- `"VALID_CLIENT_ID"` → 200 with
  ```json
  {
    "auth_type": "Bearer",
    "auth_token": "<guid>",
    "expiration_date": "<ISO-8601 timestamp, +1h>"
  }
  ```
  The issued `auth_token` is stored in the in-memory token store.
- `"INVALID_CLIENT_ID"` → 401 with `{ "error": "invalid_client" }`. No
  token is stored.
- anything else / missing → 400

**The gate trick** — `/login` won't return until someone calls
`GET /releaselogins`. This is what makes the auth-cache inflight
coalescing behaviour observable from an e2e:

1. Fire N concurrent `POST /login` (or any downstream request that
   triggers a refresh) — they queue on the same gate.
2. Call `GET /releaselogins` once.
3. All pending logins resume and return (success or 401) together.
4. A fresh gate is installed for the next batch.

With inflight coalescing wired correctly, the app should only issue
**one** `POST /login` regardless of how many concurrent downstream
requests triggered the auth refresh — a single `/releaselogins` is
then enough to unblock all of them, and `/getlogs` will show exactly
one `POST /login -> …` line.

## Token store

Every successful `/login` issues a fresh GUID and adds it to the
in-memory token store. `/pet/{id}` and `/swagger.json` both require
`Authorization: Bearer <token>` where `<token>` is currently in the
store — otherwise 401.

Tests drive the auth-error-code retry path by calling
`POST /cleartokens` mid-scenario: previously-valid tokens suddenly
start failing, the app's downstream request gets a 401, the
auth-cache invalidates + refreshes, and a fresh login issues a new
token.

## Log store

Every call to `/login`, `/pet/{id}`, `/swagger.json` — success or
failure — appends a single line to an in-memory log:

```
POST /login -> 200
POST /login -> 401
GET /pet/1 -> 200
GET /pet/1 -> 401
GET /swagger.json -> 200
```

The gate, cleartokens and the log-control routes themselves are NOT
logged. Tests read the log via `GET /getlogs` to assert exact request
shapes, coalescing, and retry counts; they reset it with
`POST /clear_logs` between scenarios.

## Running

```bash
# From repo root
docker compose -f restorm/tests/docker/docker-compose.yml up auth-service
# or as part of the full test stack
pnpm --filter restorm docker:up
```

Service listens on `http://localhost:5110`.
