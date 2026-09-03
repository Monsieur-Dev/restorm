import { useEffect, useState } from 'react'
import type { DesignCodegenTemplate, DesignTemplateSource } from '../../../shared/types/collections'
import type { TemplateVariableDecl } from '../../../shared/design/templateVariables'

/** Session cache of a source's declared variables (the main process caches too;
 * this avoids even the IPC round-trip on re-render). Module-level so it survives
 * remounts, and `inFlight` dedupes concurrent fetches for the same source. */
const cache = new Map<string, TemplateVariableDecl[]>()
const inFlight = new Set<string>()

function sourceKey(source: DesignTemplateSource): string {
  if (source.kind === 'repo') return `repo:${source.repo}@${source.ref ?? 'main'}`
  return `local:${source.path}`
}

/**
 * The variables each configured template DECLARES in its manifest, keyed by
 * templateId — used to PRE-FILL the variable editors. Fetched lazily per source
 * (cached, deduped), so the editors render immediately with the stored values
 * and the declared keys appear once the (possibly remote) manifest resolves. A
 * failed fetch caches an empty list, so the UI falls back to free keys.
 */
export function useTemplateDeclaredVariables(templates: DesignCodegenTemplate[]): Map<string, TemplateVariableDecl[]> {
  const [, setVersion] = useState(0)

  useEffect(() => {
    // Guard the preload method — it is absent until the app is restarted after a
    // preload change; the editors then simply fall back to free keys.
    const getVariables = window.restorm?.designCodegen.getVariables
    if (typeof getVariables !== 'function') return
    for (const template of templates) {
      const key = sourceKey(template.source)
      if (cache.has(key) || inFlight.has(key)) continue
      inFlight.add(key)
      void getVariables(template.source)
        .then((result) => {
          cache.set(key, result.success && result.variables !== undefined
            ? (result.variables as TemplateVariableDecl[])
            : [])
        })
        .catch(() => { cache.set(key, []) })
        // Warm cache → re-render so the editors read the decls. A resolve after
        // unmount just no-ops the state update (React ignores it); the cache is
        // set regardless, so a later mount reads it synchronously.
        .finally(() => { inFlight.delete(key); setVersion((v) => v + 1) })
    }
  }, [templates])

  const byTemplate = new Map<string, TemplateVariableDecl[]>()
  for (const template of templates) byTemplate.set(template.id, cache.get(sourceKey(template.source)) ?? [])
  return byTemplate
}
