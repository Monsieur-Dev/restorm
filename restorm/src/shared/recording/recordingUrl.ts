/**
 * The url a recording session may listen on: a remote http(s) page, a
 * `localhost:<port>` dev server, or a local html page (`file://`). The
 * record button is enabled only for one of these; everything else
 * (`javascript:`, `data:`, a bare word) is refused.
 */
export function isRecordableUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed === '') return false
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return false
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname !== ''
  if (url.protocol === 'file:') return url.pathname !== '' && url.pathname !== '/'
  return false
}
