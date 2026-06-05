using System.Text.Json;
using System.Text.Json.Serialization;

// Minimal test service used by the `auth-login` e2e suite to exercise
// the authentication-cache pipeline end-to-end. Public endpoints:
//
//   POST /login           — consumes `{ "client_id": "…" }`.
//                            • VALID_CLIENT_ID   → 200 with an
//                              issued Bearer token (GUID). The token
//                              is added to an in-memory token store
//                              so `/pet/{id}` and `/swagger.json` can
//                              validate it.
//                            • INVALID_CLIENT_ID → 401.
//                            The response is GATED — it doesn't come
//                            back until `GET /releaselogins` fires —
//                            UNLESS the request carries `?probe=1`, which
//                            makes it NON-blocking and records it in the
//                            probe store (used by the scenario-engine auth
//                            e2e, which drives the auto-login unattended).
//                            Every call is appended to the log store.
//   GET  /releaselogins   — unblocks every login currently waiting on
//                            the gate; installs a fresh gate for the
//                            next batch. NOT logged.
//   GET  /pet/{id}        — static pet payload, gated on a Bearer
//                            token that must be present in the token
//                            store (i.e. issued by /login and not
//                            since revoked via /cleartokens). Every
//                            call is appended to the log store.
//   GET  /swagger.json    — pet-only OpenAPI 3.0 spec; also gated on
//                            a valid Bearer token. Every call is
//                            appended to the log store.
//
// Test-only endpoints (never referenced by the sample collection;
// called directly by the e2e via raw HTTP):
//
//   POST /cleartokens     — empties the token store.
//   POST /clear_logs      — empties the log store AND the probe store.
//   GET  /getlogs         — snapshot of the log store.
//   GET  /loginprobe      — snapshot of the probe store (the `?probe=1`
//                            logins seen since the last /clear_logs).
//
//   GET  /health          — liveness probe, NOT logged.

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

const string ValidClientId = "VALID_CLIENT_ID";
const string InvalidClientId = "INVALID_CLIENT_ID";

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/login", async (HttpRequest req) =>
{
    // A `?probe=1` marker flips this login into NON-blocking mode AND records
    // it in the ProbeStore. The scenario-engine auth e2e drives the auto-login
    // unattended (it can't pump /releaselogins mid-run), and asserts the login
    // fired by reading GET /loginprobe afterwards. Every OTHER caller — the
    // auth-login e2e, the import flow — omits the marker and keeps the normal
    // gated behaviour, so this is purely additive.
    bool isProbe = req.Query.ContainsKey("probe");

    // Accept both JSON and application/x-www-form-urlencoded bodies —
    // real clients use either, and the e2e drives this endpoint via
    // the inline auth form which has a form-fields KeyValueTable that
    // is far easier to reach in Playwright than a Monaco editor.
    string? clientId;
    if (req.HasFormContentType)
    {
        var form = await req.ReadFormAsync();
        clientId = form["client_id"].ToString();
    }
    else
    {
        try
        {
            var payload = await JsonSerializer.DeserializeAsync<LoginPayload>(req.Body, jsonOptions);
            clientId = payload?.ClientId;
        }
        catch (JsonException)
        {
            LogStore.Append("POST /login -> 400");
            return Results.BadRequest(new { error = "invalid_json" });
        }
    }

    // Capture the current gate BEFORE we await. A concurrent
    // `/releaselogins` swaps the gate in-place; we must wait on the
    // instance that was active when we started so release semantics
    // stay batch-scoped. A `?probe=1` login skips the gate entirely.
    if (!isProbe)
    {
        await LoginGate.CurrentTask;
    }

    if (string.IsNullOrWhiteSpace(clientId))
    {
        LogStore.Append("POST /login -> 400");
        return Results.BadRequest(new { error = "missing_client_id" });
    }
    if (clientId == InvalidClientId)
    {
        LogStore.Append("POST /login -> 401");
        return Results.Json(new { error = "invalid_client" }, statusCode: 401);
    }
    if (clientId != ValidClientId)
    {
        LogStore.Append("POST /login -> 400");
        return Results.BadRequest(new
        {
            error = "unknown_client_id",
            expected = new[] { ValidClientId, InvalidClientId }
        });
    }

    var token = Guid.NewGuid().ToString("N");
    TokenStore.Add(token);
    LogStore.Append("POST /login -> 200");
    if (isProbe)
    {
        // Deterministic marker (no token, no timestamp) so the run-log golden
        // of the auth scenario stays stable.
        ProbeStore.Append($"probe login: {clientId} -> 200");
    }

    return Results.Ok(new
    {
        // OAuth 2.0 RFC 6749 §5.1 standard field names. The app's
        // LocalAuthenticationRequestForm looks for these exact keys
        // (`token_type`, `access_token`, `expires_in`) to auto-fill
        // the Configuration tab on a successful Send — the import
        // e2e scenario asserts on that auto-fill.
        token_type = "bearer",
        access_token = token,
        expires_in = 3600,
        // Aliases from the e2e spec. `expiration_date` is the
        // absolute ISO timestamp (the seconds-TTL is `expires_in`
        // above). Kept on the payload so handlebars authors can
        // reference either naming convention.
        auth_type = "bearer",
        auth_token = token,
        expiration_date = DateTimeOffset.UtcNow.AddHours(1).ToString("O")
    });
});

app.MapGet("/releaselogins", () =>
{
    LoginGate.Release();
    return Results.Ok(new { released = true });
});

app.MapGet("/pet/{id:int}", (int id, HttpRequest req) =>
{
    if (!TryGetBearerToken(req, out var token) || !TokenStore.Contains(token))
    {
        LogStore.Append($"GET /pet/{id} -> 401");
        return Results.Json(new { error = "missing_or_invalid_authorization" }, statusCode: 401);
    }

    LogStore.Append($"GET /pet/{id} -> 200");
    return Results.Ok(new
    {
        id,
        name = "Rex",
        status = "available",
        category = new { id = 1, name = "Dogs" },
        tags = new[] { new { id = 1, name = "friendly" } }
    });
});

// Second pet-API route. Exists for the refresh-from-source e2e, which
// imports only `/pet/{id}` on first pass, then re-runs the wizard and
// ticks `/pet/inventory` to confirm the wizard's selective re-import
// path actually reaches new operations through the existing
// authentication route.
app.MapGet("/pet/inventory", (HttpRequest req) =>
{
    if (!TryGetBearerToken(req, out var token) || !TokenStore.Contains(token))
    {
        LogStore.Append("GET /pet/inventory -> 401");
        return Results.Json(new { error = "missing_or_invalid_authorization" }, statusCode: 401);
    }

    LogStore.Append("GET /pet/inventory -> 200");
    return Results.Ok(new
    {
        available = 5,
        pending = 2,
        sold = 1
    });
});

app.MapGet("/swagger.json", (HttpRequest req) =>
{
    if (!TryGetBearerToken(req, out var token) || !TokenStore.Contains(token))
    {
        LogStore.Append("GET /swagger.json -> 401");
        return Results.Json(new { error = "missing_or_invalid_authorization" }, statusCode: 401);
    }

    LogStore.Append("GET /swagger.json -> 200");
    return Results.Content(PetOnlyOpenApiSpec(), "application/json");
});

// Test-only helpers. Not advertised in the swagger and not referenced
// by the sample collection — driven exclusively from the e2e via raw
// HTTP calls so tests can reset / inspect the in-memory state.

app.MapPost("/cleartokens", () =>
{
    TokenStore.Clear();
    return Results.Ok(new { cleared = true });
});

app.MapPost("/clear_logs", () =>
{
    LogStore.Clear();
    ProbeStore.Clear();
    return Results.Ok(new { cleared = true });
});

app.MapGet("/getlogs", () => Results.Ok(new { logs = LogStore.Snapshot() }));

// Test-only: the probe-marked (`?probe=1`) logins received since the last
// /clear_logs. The scenario-engine auth e2e reads this to confirm a downstream
// `/pet/{id}` actually triggered its preconfigured login route.
app.MapGet("/loginprobe", () => Results.Ok(new { calls = ProbeStore.Snapshot() }));

app.Run();

static bool TryGetBearerToken(HttpRequest req, out string token)
{
    token = string.Empty;
    if (!req.Headers.TryGetValue("Authorization", out var values)) return false;
    var header = values.ToString();
    if (string.IsNullOrWhiteSpace(header)) return false;
    if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;
    var candidate = header.Substring("Bearer ".Length).Trim();
    if (candidate.Length == 0) return false;
    token = candidate;
    return true;
}

// Swagger 2.0 (rather than OpenAPI 3.0) because restorm's
// SwaggerImportService is written against the 2.0 shape — it reads
// top-level `host` / `schemes` / `basePath` to build the env folder's
// `{{scheme}}`, `{{host}}`, `{{port}}`, `{{baseRoute}}` variables.
// A 3.0 `servers` array parses down to empty host, giving a useless
// `https://` `{{baseUrl}}`.
static string PetOnlyOpenApiSpec() => """
{
  "swagger": "2.0",
  "info": {
    "title": "Auth Test Service — Pet API",
    "version": "1.0.0",
    "description": "Static pet endpoint used by the auth-login e2e. Login is documented out-of-band."
  },
  "host": "localhost:5110",
  "schemes": ["http"],
  "securityDefinitions": {
    "bearerAuth": {
      "type": "apiKey",
      "name": "Authorization",
      "in": "header",
      "description": "Bearer token issued by /login"
    }
  },
  "paths": {
    "/pet/{id}": {
      "get": {
        "operationId": "getPetById",
        "summary": "Find pet by ID",
        "produces": ["application/json"],
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "integer",
            "format": "int32"
          }
        ],
        "security": [ { "bearerAuth": [] } ],
        "responses": {
          "200": {
            "description": "Pet",
            "schema": { "$ref": "#/definitions/Pet" }
          },
          "401": { "description": "Missing or invalid authorization" }
        }
      }
    },
    "/pet/inventory": {
      "get": {
        "operationId": "getPetInventory",
        "summary": "Pet inventory",
        "produces": ["application/json"],
        "security": [ { "bearerAuth": [] } ],
        "responses": {
          "200": {
            "description": "Inventory counts",
            "schema": {
              "type": "object",
              "properties": {
                "available": { "type": "integer" },
                "pending": { "type": "integer" },
                "sold": { "type": "integer" }
              }
            }
          },
          "401": { "description": "Missing or invalid authorization" }
        }
      }
    }
  },
  "definitions": {
    "Pet": {
      "type": "object",
      "properties": {
        "id": { "type": "integer", "format": "int32" },
        "name": { "type": "string" },
        "status": { "type": "string" },
        "category": {
          "type": "object",
          "properties": {
            "id": { "type": "integer" },
            "name": { "type": "string" }
          }
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "integer" },
              "name": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
""";

/// <summary>
/// Process-wide gate used by /login and /releaselogins.
///
/// Pattern: one <see cref="TaskCompletionSource"/> is the "current" gate.
/// Every /login awaits <see cref="CurrentTask"/> before sending its
/// response. <see cref="Release"/> completes the current TCS (which
/// unblocks every waiter attached to it) and installs a fresh,
/// unresolved TCS for the next batch.
///
/// Why <see cref="TaskCreationOptions.RunContinuationsAsynchronously"/>:
/// without it, callers of <see cref="TaskCompletionSource.TrySetResult"/>
/// can end up running the awaiter continuations inline on their own
/// thread, which could stall the /releaselogins response if a waiter
/// continuation does something slow.
/// </summary>
public static class LoginGate
{
    private static TaskCompletionSource _tcs =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static readonly object _lock = new();

    public static Task CurrentTask
    {
        get
        {
            lock (_lock) { return _tcs.Task; }
        }
    }

    public static void Release()
    {
        TaskCompletionSource toRelease;
        lock (_lock)
        {
            toRelease = _tcs;
            _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        toRelease.TrySetResult();
    }
}

/// <summary>
/// In-memory set of Bearer tokens currently considered valid. Every
/// successful `/login` adds one; `/cleartokens` empties the set so
/// previously-issued tokens start failing — this is how the e2e
/// drives the auth-error-code retry path without restarting the
/// container.
/// </summary>
public static class TokenStore
{
    private static readonly HashSet<string> _tokens = new(StringComparer.Ordinal);
    private static readonly object _lock = new();

    public static void Add(string token) { lock (_lock) _tokens.Add(token); }
    public static bool Contains(string token)
    {
        lock (_lock) return _tokens.Contains(token);
    }
    public static void Clear() { lock (_lock) _tokens.Clear(); }
}

/// <summary>
/// Append-only list of "METHOD PATH -> STATUS" entries for the three
/// endpoints the e2e cares about (login, pet, swagger). The sidebar-
/// triggered requests + the coalescing behaviour of
/// AuthenticationCacheService become observable by diffing the log
/// before / after a scenario.
/// </summary>
public static class LogStore
{
    private static readonly List<string> _entries = new();
    private static readonly object _lock = new();

    public static void Append(string entry)
    {
        lock (_lock) _entries.Add(entry);
    }

    public static IReadOnlyList<string> Snapshot()
    {
        lock (_lock) return _entries.ToList();
    }

    public static void Clear()
    {
        lock (_lock) _entries.Clear();
    }
}

/// <summary>
/// Append-only list of probe-marked (`?probe=1`) login calls. Separate from
/// <see cref="LogStore"/> so the auth-scenario e2e can assert "the login route
/// fired" without coupling to whatever else the log happens to hold. Cleared by
/// /clear_logs alongside the main log.
/// </summary>
public static class ProbeStore
{
    private static readonly List<string> _entries = new();
    private static readonly object _lock = new();

    public static void Append(string entry)
    {
        lock (_lock) _entries.Add(entry);
    }

    public static IReadOnlyList<string> Snapshot()
    {
        lock (_lock) return _entries.ToList();
    }

    public static void Clear()
    {
        lock (_lock) _entries.Clear();
    }
}

public sealed record LoginPayload(
    [property: JsonPropertyName("client_id")] string? ClientId
);
