/**
 * A JSON document pasted into the import source field is shown pretty-printed
 * — a spec exported on one line is unreadable otherwise. Only a PASTE into an
 * EMPTY field qualifies (typing, or pasting a fragment into existing text, is
 * left alone), and only when the clipboard text is a complete JSON object or
 * array; anything else (a url, a path, YAML, broken JSON) is pasted verbatim.
 * Returns the text to put in the field, or `null` to let the paste proceed.
 */
export function prettyPrintedPaste(currentInput: string, pasted: string): string | null {
  if (currentInput.trim() !== '') return null
  const text = pasted.trim()
  if (!/^[{[]/.test(text)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const pretty = JSON.stringify(parsed, null, 2)
  return pretty === text ? null : pretty
}
