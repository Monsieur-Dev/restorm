export type DotenvMap = Record<string, string>
export interface ParsedEnvFile {
  vars: DotenvMap
  duplicates: string[]
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t'
}

function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/"/g, '\\"')
}

function unescapeValue(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? ''
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = value[i + 1] ?? ''
    if (next === 'n') {
      out += '\n'
      i++
      continue
    }
    if (next === 'r') {
      out += '\r'
      i++
      continue
    }
    if (next === 't') {
      out += '\t'
      i++
      continue
    }
    if (next === '"') {
      out += '"'
      i++
      continue
    }
    if (next === '\\') {
      out += '\\'
      i++
      continue
    }
    // Unknown escape: keep the backslash as-is
    out += ch
  }
  return out
}

export function serializeEnvFile(vars: DotenvMap): string {
  const lines: string[] = []
  for (const [key, raw] of Object.entries(vars)) {
    // Always quote to preserve '=' and whitespace safely
    lines.push(`${key}="${escapeValue(raw)}"`)
  }
  return lines.join('\n') + '\n'
}

export function parseEnvFileDetailed(text: string): ParsedEnvFile {
  const out: DotenvMap = {}
  const duplicates: string[] = []
  const lines = text.split(/\r?\n/)

  const setVar = (key: string, value: string): void => {
    if (key in out) {
      duplicates.push(key)
    }
    out[key] = value
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq <= 0) continue

    const key = line.slice(0, eq).trim()
    let valuePart = line.slice(eq + 1)

    // Remove leading spaces after '='
    while (valuePart.length > 0 && isWhitespace(valuePart[0] ?? '')) {
      valuePart = valuePart.slice(1)
    }

    if (!key) continue

    if (valuePart.startsWith('"')) {
      // Quoted value: find closing quote, support escapes
      let acc = ''
      let escaped = false
      for (let i = 1; i < valuePart.length; i++) {
        const ch = valuePart[i] ?? ''
        if (escaped) {
          acc += '\\' + ch
          escaped = false
          continue
        }
        if (ch === '\\') {
          escaped = true
          continue
        }
        if (ch === '"') {
          setVar(key, unescapeValue(acc))
          acc = ''
          break
        }
        acc += ch
      }
      if (!(key in out)) {
        // No closing quote found; fallback
        setVar(key, unescapeValue(valuePart.slice(1)))
      }
      continue
    }

    if (valuePart.startsWith("'")) {
      // Single quotes: no escapes (dotenv-like behavior)
      const end = valuePart.lastIndexOf("'")
      setVar(key, end > 0 ? valuePart.slice(1, end) : valuePart.slice(1))
      continue
    }

    // Unquoted: strip trailing inline comment if present
    const hash = valuePart.indexOf(' #')
    const rawValue = hash >= 0 ? valuePart.slice(0, hash) : valuePart
    setVar(key, unescapeValue(rawValue.trim()))
  }

  return { vars: out, duplicates }
}

export function parseEnvFile(text: string): DotenvMap {
  return parseEnvFileDetailed(text).vars
}
