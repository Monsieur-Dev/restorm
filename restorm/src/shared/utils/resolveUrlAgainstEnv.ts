/**
 * Replace `{{name}}` handlebars in a URL template with the matching
 * value from a flat `envVars` map. Names not present in the map are
 * left intact — typically path-params like `{{petId}}` that vary
 * per request and shouldn't be resolved here.
 *
 * Used by the documentation matcher (URL → spec operation lookup):
 * - The Docs tab visibility decision and the refresh modal's
 *   "lock already-imported routes" logic both run the same matcher.
 * - The matcher operates on resolved URLs so it doesn't have to
 *   hardcode a specific variable name (the user can pick
 *   `{{baseUrl}}`, `{{server}}`, `{{api}}`, etc.). Path-params left
 *   intact still match the operation's `{petId}` slot via the
 *   `[^/]+` wildcard the matcher generates.
 *
 * Run `flattenEnvVars` on the raw env-vars map first when the values
 * themselves contain handlebars (the Swagger importer composes
 * `baseUrl = {{scheme}}://{{host}}:{{port}}{{baseRoute}}`, for
 * example). That helper iterates until references settle so this
 * function only has to do a single pass.
 */
export function resolveUrlAgainstEnv(
  url: string,
  envVars: Record<string, string>
): string {
  return url.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) => envVars[name] ?? match)
}

/**
 * Flatten an env-vars map by iteratively resolving handlebars in
 * each value against the others. Required when imports compose a
 * variable from sub-variables (Swagger's structured `baseUrl =
 * {{scheme}}://{{host}}:{{port}}{{baseRoute}}` is the canonical
 * case). Caps at 10 iterations to short-circuit accidental cycles
 * — values still containing handlebars after the cap stay as-is,
 * which the matcher will treat literally.
 */
export function flattenEnvVars(rawVars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...rawVars }
  for (let iter = 0; iter < 10; iter++) {
    let changed = false
    for (const key of Object.keys(out)) {
      const before = out[key]
      if (!before?.includes('{{')) continue
      const after = resolveUrlAgainstEnv(before, out)
      if (after !== before) {
        out[key] = after
        changed = true
      }
    }
    if (!changed) break
  }
  return out
}
