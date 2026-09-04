import { useMemo } from 'react'
import type { VariableDefinition } from 'electron-core-ui/renderer'
import { useRestormStore } from '../store/restormStore'
import { coerceEnvVarValue } from '../../../shared/utils/resolveUrlAgainstEnv'

/**
 * The variables a design can reference — the union of every environment in
 * the env-folder that CONTAINS the design (a design inside an env-folder
 * resolves `{{variables}}` like a request does). Feeds the
 * `RestormVariableInputBox` autocomplete on the design's URL-shaped fields
 * (base path, serve port, route paths). A design at the document root has
 * no owning folder, so the list is empty.
 *
 * The returned array reference is STABLE until the variables' CONTENT
 * actually changes (it is memoised on a content signature): the input box
 * is `React.memo`-ed and re-initialises its Monaco editor — stealing focus
 * mid-typing — whenever its `variables` prop changes identity, so an
 * unrelated store churn (autosave, serving status) must not hand it a fresh
 * array.
 */
export function useDesignEnvVariables(designId: string): VariableDefinition[] {
  // Subscribe to the collections DATA, not just the stable finder function —
  // selecting the function alone never re-renders when a variable changes.
  const collections = useRestormStore((state) => state.collections)
  const findOwningEnvironmentFolder = useRestormStore((state) => state.findOwningEnvironmentFolder)
  void collections
  const folder = findOwningEnvironmentFolder(designId)

  const vars: VariableDefinition[] = []
  const seen = new Set<string>()
  for (const env of folder?.environments ?? []) {
    for (const kv of env.variables) {
      if (kv.key === '' || seen.has(kv.key)) continue
      seen.add(kv.key)
      vars.push({ name: kv.key, value: coerceEnvVarValue(kv.value) ?? '' })
    }
  }

  // Memoise on the serialized content so the identity only flips on a real
  // change; the callback rebuilds from the signature alone, so it needs no
  // reactive dependency on the (churning) folder object.
  const signature = JSON.stringify(vars)
  return useMemo(() => JSON.parse(signature) as VariableDefinition[], [signature])
}
