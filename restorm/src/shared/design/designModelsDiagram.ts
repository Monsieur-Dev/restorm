import type { DesignModel } from '../types/collections'

/** A mermaid-safe class id derived from a model name (fallback + de-duped). */
function safeId(name: string, i: number, used: Set<string>): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_')
  let sid = /^[A-Za-z_]/.test(cleaned) && cleaned !== '' ? cleaned : `M${i}`
  while (used.has(sid)) sid = `${sid}_`
  used.add(sid)
  return sid
}

const esc = (s: string): string => s.replace(/["\n]/g, ' ').trim()

/**
 * A mermaid `classDiagram` of a design's MODELS — each model a class with its
 * own properties, inheritance drawn as generalization (`Parent <|-- Child`) and
 * model references as associations (`A --> B : field`). Rendered by the shared
 * MarkdownViewer in the Models view's "graph" tab.
 */
export function modelsClassDiagram(models: readonly DesignModel[]): string {
  const lines: string[] = ['classDiagram']
  if (models.length === 0) return lines.join('\n')

  const used = new Set<string>()
  // Pair each model with its class id up front so the id is always in hand (no
  // Map lookup that the types would let come back undefined).
  const entries = models.map((m, i) => ({
    model: m,
    sid: safeId(m.doc.name !== '' ? m.doc.name : `Model${i + 1}`, i, used)
  }))
  const idOf = new Map(entries.map((e) => [e.model.id, e.sid]))

  for (const { model: m, sid } of entries) {
    lines.push(`class ${sid}["${esc(m.doc.name !== '' ? m.doc.name : '(unnamed)')}"] {`)
    for (const p of m.properties) {
      lines.push(`  +${esc(p.doc.type)} ${esc(p.doc.name !== '' ? p.doc.name : '?')}`)
    }
    lines.push('}')
  }

  for (const { model: m, sid } of entries) {
    const parent = m.design?.inheritsFrom
    if (parent !== undefined) {
      const parentSid = idOf.get(parent)
      if (parentSid !== undefined) lines.push(`${parentSid} <|-- ${sid}`)
    }
    for (const p of m.properties) {
      const ref = p.design?.reference
      if (ref?.target === 'model') {
        const refSid = idOf.get(ref.refId)
        if (refSid !== undefined) lines.push(`${sid} --> ${refSid} : ${esc(p.doc.name)}`)
      }
    }
  }
  return lines.join('\n')
}
