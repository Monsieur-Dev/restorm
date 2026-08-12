# Release signing & notarization runbook

How Restorm's release builds get code-signed (macOS, Windows) and notarized
(macOS), which secrets drive it, and how to (re)generate them. Linux artifacts
(AppImage / deb / rpm) are not signed — nothing to do there.

The whole mechanism is **inert until the secrets exist**: `release.yml` passes
every secret through as an environment variable, an unset secret yields an
empty value, and electron-builder treats empty as absent — so an
uncredentialed run produces exactly the unsigned artifacts it always did.
There is no branch, flag or workflow edit to flip besides creating the
secrets.

## macOS — signing + notarization

### What the build does once the secrets exist

- `build.mac` in `package.json` carries `hardenedRuntime: true` and the two
  entitlement files under `build/entitlements.mac*.plist`. The entitlements
  grant JIT + unsigned-executable-memory (Electron/V8 and every embedded
  WASM engine — pyodide, webr, quickjs-emscripten, wasmoon, dotnet-wasm —
  JIT-compile into writable+executable pages, which the hardened runtime
  forbids by default) and disable library validation (the asar-unpacked
  `*.node` native modules).
- `release.yml`'s build step adds `-c.mac.notarize=true` when
  `APPLE_TEAM_ID` is set, signs with the `CSC_LINK`/`CSC_KEY_PASSWORD`
  identity, and notarizes through `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`
  + `APPLE_TEAM_ID` (electron-builder ≥ 26 drives `@electron/notarize`
  natively — no custom `afterSign` hook).
- The "Verify signature + notarization (macOS)" step then proves the result
  in the job log: `codesign --verify --deep --strict`, `xcrun stapler
  validate` (the stapled notarization ticket — what `electron-updater`
  checks offline), `spctl --assess --type execute` (Gatekeeper's verdict).

### Secrets (GitHub Actions → repository secrets)

| Secret | Content |
| --- | --- |
| `MAC_CSC_LINK` | The Developer ID Application certificate as a **base64-encoded `.p12`** |
| `MAC_CSC_KEY_PASSWORD` | The `.p12` passphrase |
| `APPLE_ID` | The Apple ID email of the enrolled developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID (appleid.apple.com → Sign-In and Security → App-Specific Passwords) |
| `APPLE_TEAM_ID` | The 10-character Team ID (developer.apple.com → Membership) |

### Generating the certificate — no Mac required

Prerequisite: an active Apple Developer Program membership (Team ID).

1. Private key + CSR on any Linux box:

   ```bash
   openssl genrsa -out developer-id.key 2048
   openssl req -new -key developer-id.key -out developer-id.csr \
     -subj "/emailAddress=<apple-id-email>/CN=Restorm Developer ID/C=FR"
   ```

2. developer.apple.com → Certificates → `+` → **Developer ID Application**
   → upload `developer-id.csr` → download `developer_id_application.cer`.

3. Bundle key + cert (+ Apple's intermediate) into a `.p12`:

   ```bash
   # Apple's Developer ID intermediate (G2):
   curl -O https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
   openssl x509 -inform DER -in developer_id_application.cer -out cert.pem
   openssl x509 -inform DER -in DeveloperIDG2CA.cer -out intermediate.pem
   openssl pkcs12 -export -inkey developer-id.key -in cert.pem \
     -certfile intermediate.pem -out developer-id.p12
   # (choose the passphrase → MAC_CSC_KEY_PASSWORD)
   base64 -w0 developer-id.p12   # → MAC_CSC_LINK
   ```

4. Store the four values as secrets, keep the `.key`/`.p12` in the team
   password manager, and **delete the local files**.

### Expiration & rotation

Developer ID Application certificates live **5 years**. To rotate: repeat
the generation above (the old cert can stay valid in parallel), replace
`MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD`, and cut a release — already-shipped
notarized builds remain valid forever (the stapled ticket does not expire
with the certificate). The app-specific password can be revoked/regenerated
at any time on appleid.apple.com with no effect on shipped builds.

## Windows — Azure Trusted Signing (pending final mechanism decision)

The chosen direction is Azure Trusted Signing (cloud HSM, CI-friendly,
~120 $/year) — OV token certificates stopped being CI-automatable when key
custody moved to hardware tokens.

Once the Azure resource exists (Trusted Signing account + certificate
profile + an app registration with the *Trusted Signing Certificate Profile
Signer* role), wire it as:

1. `package.json` → `build.win`:

   ```json
   "azureSignOptions": {
     "endpoint": "https://<region>.codesigning.azure.net",
     "codeSigningAccountName": "<account>",
     "certificateProfileName": "<profile>",
     "publisherName": "<verified publisher CN>"
   }
   ```

2. Secrets (already passed through by `release.yml`): `AZURE_TENANT_ID`,
   `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

3. Verify on the artifact: `signtool verify /pa /v <installer>.exe`.

SmartScreen reputation builds progressively with a Trusted Signing
certificate (immediately clean only with EV).

## Local / debugging notes

- A local `pnpm run dist` never signs (no `CSC_*` env locally) — signing and
  notarization are CI-only by construction.
- Notarization adds ~5-15 min to the mac job (Apple's service); a failed
  notarization prints the submission log URL in the electron-builder output.
- `CSC_IDENTITY_AUTO_DISCOVERY: false` stays set in CI: it only disables
  *keychain* auto-discovery; the explicit `CSC_LINK` identity is unaffected.
