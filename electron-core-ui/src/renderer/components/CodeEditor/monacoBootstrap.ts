import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
// Vite ?worker suffix → each worker file is bundled into its own
// chunk and exported as a constructor. The handler below picks the
// matching worker class based on the language label Monaco passes.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/**
 * One-time Monaco bootstrap. Without this, `@monaco-editor/react`
 * uses its bundled `loader` (`@monaco-editor/loader`) which downloads
 * the full Monaco bundle from `cdn.jsdelivr.net` at first `<Editor>`
 * mount + asks Monaco to fetch its web workers from the same CDN.
 *
 * Both are wrong for an Electron app shipped offline:
 *
 * 1. `loader.config({ monaco })` tells `@monaco-editor/react` to use
 *    the `monaco-editor` we already npm-pulled instead of going to
 *    JsDelivr. Disabled `paths` for safety so even if some stray
 *    code-path tries the loader, it'll fail loud rather than silent
 *    -fall-back to the network.
 *
 * 2. `self.MonacoEnvironment.getWorker(_, label)` returns a Vite-
 *    bundled `Worker` instance for each language Monaco asks about.
 *    The `?worker` suffix is Vite's hint to emit each worker as its
 *    own chunk; production builds therefore include the workers as
 *    static assets next to the renderer bundle.
 *
 * Idempotent: calling twice is a no-op (the `loader.config` call
 * just reassigns its internal pointer; `MonacoEnvironment` is also
 * just a property assignment).
 */
let bootstrapped = false

export function bootstrapMonaco(): void {
	if (bootstrapped) return
	bootstrapped = true

	loader.config({ monaco })

	;(self as unknown as { MonacoEnvironment: { getWorker: (_workerId: string, label: string) => Worker } }).MonacoEnvironment = {
		getWorker(_workerId: string, label: string): Worker {
			switch (label) {
				case 'json': return new JsonWorker()
				case 'css':
				case 'scss':
				case 'less': return new CssWorker()
				case 'html':
				case 'handlebars':
				case 'razor': return new HtmlWorker()
				case 'typescript':
				case 'javascript': return new TypeScriptWorker()
				default: return new EditorWorker()
			}
		}
	}
}
