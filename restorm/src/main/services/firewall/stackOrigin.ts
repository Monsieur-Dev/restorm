/**
 * Walk the V8 stack at the point of an intercepted call and produce a
 * short, human-meaningful caller hint — e.g. `npm package "axios"` or
 * `restorm/main/services/HTTPExecutionService.ts:42`. Used to enrich
 * the toast prompt's "from <hint>" line and the `RequestRecord`'s
 * `originHint` field.
 *
 * The walk skips:
 *   - Node internals (`node:`, `internal/`).
 *   - Restorm's own firewall layer (this file + `MainProcessInterceptor`
 *     + `BufferingClientRequest` + `FirewallService`) — every call
 *     inevitably passes through them, so they'd always win.
 *   - The first `skipFrames` frames the caller wants ignored (its own
 *     wrapper that called `captureOriginHint`).
 *
 * The first surviving frame wins. If it points inside `node_modules`,
 * we surface the package name; otherwise we surface the source file
 * basename + line.
 *
 * Works at best-effort: if the stack is unparseable (bundled /
 * minified / cross-compile / source maps disabled) we return `null`
 * and the caller falls back to the source label ("main-http" etc).
 */

const FIREWALL_PATH_MARKERS = [
	'/services/firewall/',
	'\\services\\firewall\\'
]

const NODE_INTERNAL_MARKERS = [
	'node:',
	'internal/'
]

const NODE_MODULES_MARKER = 'node_modules'

interface ParsedFrame {
	raw: string
	file: string | null
	line: number | null
}

export function captureOriginHint(skipFrames = 0): string | null {
	const holder = { stack: '' }
	Error.captureStackTrace(holder, captureOriginHint)
	const lines = holder.stack.split('\n').slice(1) // drop the leading "Error" line
	const frames = lines.map(parseFrame).filter((f): f is ParsedFrame => f !== null)

	let consumed = 0
	for (const frame of frames) {
		if (frame.file === null) continue
		if (NODE_INTERNAL_MARKERS.some((m) => frame.file?.startsWith(m))) continue
		if (FIREWALL_PATH_MARKERS.some((m) => frame.file?.includes(m))) continue
		if (consumed < skipFrames) { consumed += 1; continue }
		return formatFrame(frame)
	}
	return null
}

/**
 * V8 stack frames look like:
 *   "    at functionName (path/to/file.js:42:11)"
 *   "    at path/to/file.js:42:11"
 *   "    at async functionName (path/to/file.js:42:11)"
 * We only need the file + line; drop the column / function-name noise.
 */
const PAREN_LOCATION_RE = /\(([^)]+)\)\s*$/
const FILE_LINE_RE = /^(.*?):(\d+)(?::\d+)?$/
function parseFrame(line: string): ParsedFrame | null {
	const trimmed = line.trim()
	if (!trimmed.startsWith('at ')) return null
	const inside = trimmed.slice(3) // drop "at "
	const parenMatch = PAREN_LOCATION_RE.exec(inside)
	const locationStr = parenMatch !== null ? parenMatch[1] : inside
	if (locationStr === undefined) return null
	const fileLine = FILE_LINE_RE.exec(locationStr)
	if (fileLine === null) return { raw: trimmed, file: locationStr, line: null }
	const file = fileLine[1] ?? null
	const lineNum = fileLine[2] !== undefined ? Number(fileLine[2]) : null
	return { raw: trimmed, file, line: Number.isFinite(lineNum) ? lineNum : null }
}

function formatFrame(frame: ParsedFrame): string {
	if (frame.file === null) return frame.raw
	const npmIdx = frame.file.lastIndexOf(NODE_MODULES_MARKER)
	if (npmIdx !== -1) {
		const after = frame.file.slice(npmIdx + NODE_MODULES_MARKER.length + 1)
		const pkg = extractPackageName(after)
		if (pkg !== null) return `npm package "${pkg}"`
	}
	const basename = lastPathSegment(frame.file)
	return frame.line !== null ? `${basename}:${String(frame.line)}` : basename
}

/**
 * Resolve a partial path that lives below `node_modules/` to its
 * package name. Handles scoped packages (`@scope/pkg/...`) and
 * deeply nested `node_modules` chains (`a/node_modules/b/...`) by
 * returning the deepest segment.
 */
function extractPackageName(rest: string): string | null {
	const segments = rest.split(/[/\\]/)
	if (segments.length === 0) return null
	// Walk past inner `node_modules` boundaries until we find the leaf.
	let i = 0
	while (i < segments.length && segments[i] === 'node_modules') i += 1
	const seg = segments[i]
	if (seg === undefined || seg.length === 0) return null
	if (seg.startsWith('@') && i + 1 < segments.length) {
		const sub = segments[i + 1]
		if (sub !== undefined) return `${seg}/${sub}`
	}
	return seg
}

function lastPathSegment(path: string): string {
	const parts = path.split(/[/\\]/)
	const tail = parts.length > 0 ? parts[parts.length - 1] : undefined
	return tail !== undefined && tail !== '' ? tail : path
}
