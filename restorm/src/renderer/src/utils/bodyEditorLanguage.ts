/** Monaco modes the text-body editor can put a payload in. */
export type BodyEditorLanguage = 'json' | 'xml'

/**
 * Pick the Monaco mode for a free-text request body from the payload itself.
 *
 * The editor has one language slot for a field that legitimately carries JSON or
 * XML (the header alone can't decide it — a body is often written before its
 * `Content-Type`), and an XML payload validated as JSON squiggles end to end. So
 * sniff the first meaningful character, the same way the documentation viewer
 * picks a highlighter for a response example.
 *
 * Anything else — plain text, a form-encoded string, an empty body — stays
 * `json`, the mode this editor has always used.
 */
export function detectBodyEditorLanguage(body: string): BodyEditorLanguage {
  return body.trimStart().startsWith('<') ? 'xml' : 'json'
}
