/**
 * The sandbox standard library, as DATA + a bundler: the curated lib list, the
 * Node-builtin shims, and the esbuild recipe that turns them into the single
 * IIFE prelude evaluated in QuickJS before user code.
 *
 * Lives apart from `codeSandbox` so the build pipeline can generate the prelude
 * AHEAD OF TIME (`scripts/generate-sandbox-prelude.mts` → a `restorm-resources`
 * asset): in a packaged app the esbuild binary is a separate process that sees
 * `app.asar` as a plain file, so it can never resolve `node_modules` inside the
 * archive — runtime bundling only works from a real on-disk checkout (dev).
 * Electron-free on purpose: the generator script runs under plain Node.
 */

import { build as esbuild, type Plugin } from 'esbuild'

/** The curated, pure-JS standard library exposed inside the sandbox (a superset
 * of what Postman and Bruno bundle). Each entry is `globalThis.<global> = <pkg>`
 * + reachable through the `require()` shim. */
export const SANDBOX_LIBS: { global: string; module: string; requireNames: string[] }[] = [
  { global: '_', module: 'lodash', requireNames: ['lodash'] },
  { global: 'lodash', module: 'lodash', requireNames: [] },
  { global: 'moment', module: 'moment', requireNames: ['moment'] },
  { global: 'uuid', module: 'uuid', requireNames: ['uuid'] },
  { global: 'nanoid', module: 'nanoid', requireNames: ['nanoid'] },
  { global: 'CryptoJS', module: 'crypto-js', requireNames: ['crypto-js', 'CryptoJS'] },
  { global: 'Ajv', module: 'ajv', requireNames: ['ajv'] },
  // Assertions — `chai.expect` / `chai.assert` (Postman's `pm.expect` IS chai).
  // chai stays on v4: v5+ is ESM-only and its prelude touches DOM globals
  // (`Event`) that QuickJS's browser-grade ES2020 surface does not provide.
  { global: 'chai', module: 'chai', requireNames: ['chai'] },
  // HTML/XML scraping, jQuery-style — `cheerio.load(html)`.
  { global: 'cheerio', module: 'cheerio', requireNames: ['cheerio'] },
  // XML — `xml2js.parseStringPromise(xml)` (needs the events/timers shims below).
  { global: 'xml2js', module: 'xml2js', requireNames: ['xml2js'] },
  // Ajv format validators — `ajvFormats(ajvInstance)`.
  { global: 'ajvFormats', module: 'ajv-formats', requireNames: ['ajv-formats'] }
]

/** A handful of Node core modules a couple of the bundled libs (xml2js → sax)
 * pull in. QuickJS is browser-grade ES2020, so esbuild can't resolve them — we
 * substitute tiny CJS shims at bundle time. Deliberately minimal: just the
 * surface the curated libs touch, not a Node emulation layer. Exported so a
 * user-pinned package (bundled separately by `codeRuntimes/npmBundle.ts`) gets
 * the SAME shim set, not a second drifting copy. */
export const NODE_BUILTIN_SHIMS: Record<string, string> = {
  events: `
    function EventEmitter(){ if(!this._e) this._e = {}; }
    EventEmitter.prototype.on = function(t,f){ (this._e[t]=this._e[t]||[]).push(f); return this; };
    EventEmitter.prototype.addListener = EventEmitter.prototype.on;
    EventEmitter.prototype.prependListener = function(t,f){ (this._e[t]=this._e[t]||[]).unshift(f); return this; };
    EventEmitter.prototype.once = function(t,f){ var s=this; function g(){ s.removeListener(t,g); return f.apply(this,arguments); } g.listener=f; return this.on(t,g); };
    EventEmitter.prototype.removeListener = function(t,f){ var a=this._e[t]; if(a){ var i=a.indexOf(f); if(i>=0)a.splice(i,1); } return this; };
    EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
    EventEmitter.prototype.removeAllListeners = function(t){ if(t)delete this._e[t]; else this._e={}; return this; };
    EventEmitter.prototype.emit = function(t){ var a=(this._e[t]||[]).slice(),args=[].slice.call(arguments,1); for(var i=0;i<a.length;i++)a[i].apply(this,args); return a.length>0; };
    EventEmitter.prototype.listeners = function(t){ return (this._e[t]||[]).slice(); };
    EventEmitter.prototype.listenerCount = function(t){ return (this._e[t]||[]).length; };
    EventEmitter.prototype.setMaxListeners = function(){ return this; };
    EventEmitter.prototype.getMaxListeners = function(){ return 10; };
    EventEmitter.EventEmitter = EventEmitter;
    EventEmitter.defaultMaxListeners = 10;
    module.exports = EventEmitter;
  `,
  timers: `
    var setImm = (typeof globalThis.setImmediate !== 'undefined') ? globalThis.setImmediate : function(fn){ var a=[].slice.call(arguments,1); return setTimeout(function(){ fn.apply(null,a); }, 0); };
    exports.setImmediate = setImm;
    exports.clearImmediate = function(id){ return clearTimeout(id); };
    exports.setTimeout = function(){ return setTimeout.apply(null, arguments); };
    exports.clearTimeout = function(){ return clearTimeout.apply(null, arguments); };
    exports.setInterval = function(){ return setInterval.apply(null, arguments); };
    exports.clearInterval = function(){ return clearInterval.apply(null, arguments); };
  `
}

/** esbuild plugin substituting {@link NODE_BUILTIN_SHIMS} for the Node core
 * modules a few curated libs import (otherwise unresolvable under
 * `platform: 'browser'`). Exported for reuse by `codeRuntimes/npmBundle.ts`,
 * which bundles user-pinned npm packages the same way. */
export const nodeBuiltinShimPlugin: Plugin = {
  name: 'sandbox-node-builtin-shims',
  setup(build) {
    const filter = new RegExp(`^(${Object.keys(NODE_BUILTIN_SHIMS).join('|')})$`)
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'node-builtin-shim' }))
    build.onLoad({ filter: /.*/, namespace: 'node-builtin-shim' }, (args) => ({
      contents: NODE_BUILTIN_SHIMS[args.path],
      loader: 'js'
    }))
  }
}

/** Assemble the prelude's entry source: an import + `globalThis` assignment per
 * curated lib, the `require()` shim over {@link SANDBOX_LIBS}' names, and the
 * chai `expect`/`assert` convenience aliases. */
export function buildStdlibPreludeEntry(): string {
  const requireMap: Record<string, string> = {}
  const imports: string[] = []
  for (const [i, lib] of SANDBOX_LIBS.entries()) {
    const local = `__lib${i}`
    imports.push(`import * as ${local}_ns from '${lib.module}'`)
    // Interop: prefer a CJS default export, fall back to the namespace.
    imports.push(`const ${local} = ${local}_ns && ${local}_ns.default ? ${local}_ns.default : ${local}_ns`)
    imports.push(`globalThis.${lib.global} = ${local}`)
    for (const name of lib.requireNames) requireMap[name] = local
  }
  const requireShim =
    `const __req = {${Object.entries(requireMap).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ')}};` +
    `globalThis.require = (n) => { if (n in __req) return __req[n]; throw new Error('module \\'' + n + '\\' is not available in the sandbox'); };`
  // Convenience: chai's `expect` / `assert` as bare globals (mirrors Postman's
  // `pm.expect`), once `globalThis.chai` is assigned by the loop above.
  const chaiAliases = `globalThis.expect = globalThis.chai && globalThis.chai.expect; globalThis.assert = globalThis.chai && globalThis.chai.assert;`
  return `${imports.join('\n')}\n${requireShim}\n${chaiAliases}`
}

/** Bundle the standard-library prelude into a single browser-style IIFE.
 * Resolves the curated packages from `node_modules`, so it only works from a
 * real checkout (dev, tests, the build-time generator) — never from inside an
 * asar archive. `resolveDir` anchors the resolution and defaults to cwd. */
export function buildStdlibPrelude(resolveDir: string = process.cwd()): Promise<string> {
  return esbuild({
    stdin: { contents: buildStdlibPreludeEntry(), resolveDir, loader: 'ts' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    legalComments: 'none',
    plugins: [nodeBuiltinShimPlugin],
    // uuid / nanoid are namespace-only (no default) — the `.default ?? ns`
    // interop in the entry is intentional, so silence the always-undefined warnings.
    logLevel: 'silent'
  }).then((res) => res.outputFiles[0].text)
}
