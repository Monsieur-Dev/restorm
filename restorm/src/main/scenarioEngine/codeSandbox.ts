/**
 * Sandboxed TypeScript/JavaScript execution for the `code` scenario node.
 *
 * Two stages, mirroring how Postman / Bruno run user scripts:
 *  1. **Transpile** — strip TypeScript types with esbuild (`loader: 'ts'`); no
 *     type-check, just a fast syntactic transform.
 *  2. **Execute** — run the JS inside a QuickJS interpreter compiled to
 *     WebAssembly (`quickjs-emscripten`). QuickJS is a *separate* engine with no
 *     access to Node, the filesystem, the network or the host globals — the only
 *     things reachable are what we explicitly inject (a curated standard library,
 *     the node's `input`, and the run's variables). A runaway loop is bounded by
 *     a wall-clock deadline via QuickJS's interrupt handler, so it can never
 *     freeze the engine.
 *
 * The curated standard library is bundled ONCE (esbuild, cached) into a single
 * IIFE that defines the libs as globals + a `require()` shim, then evaluated in
 * the QuickJS context before the user code. Mirrors the Postman/Bruno built-ins.
 */

import { build as esbuild, transform as esbuildTransform, type Plugin } from 'esbuild'
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten'

/** The curated, pure-JS standard library exposed inside the sandbox (a superset
 * of what Postman and Bruno bundle). Each entry is `globalThis.<global> = <pkg>`
 * + reachable through the `require()` shim. */
const SANDBOX_LIBS: { global: string; module: string; requireNames: string[] }[] = [
  { global: '_', module: 'lodash', requireNames: ['lodash'] },
  { global: 'lodash', module: 'lodash', requireNames: [] },
  { global: 'moment', module: 'moment', requireNames: ['moment'] },
  { global: 'uuid', module: 'uuid', requireNames: ['uuid'] },
  { global: 'nanoid', module: 'nanoid', requireNames: ['nanoid'] },
  { global: 'CryptoJS', module: 'crypto-js', requireNames: ['crypto-js', 'CryptoJS'] },
  { global: 'Ajv', module: 'ajv', requireNames: ['ajv'] },
  // Assertions — `chai.expect` / `chai.assert` (Postman's `pm.expect` IS chai).
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
 * surface the curated libs touch, not a Node emulation layer. */
const NODE_BUILTIN_SHIMS: Record<string, string> = {
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
 * `platform: 'browser'`). */
const nodeBuiltinShimPlugin: Plugin = {
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

/** Build (once) the standard-library prelude: an IIFE that assigns each lib to a
 * global and installs a `require()` shim. esbuild resolves the packages from
 * node_modules and bundles them browser-style (no Node built-ins). */
let preludePromise: Promise<string> | null = null
function getStdlibPrelude(): Promise<string> {
  if (preludePromise) return preludePromise
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
  const entry = `${imports.join('\n')}\n${requireShim}\n${chaiAliases}`
  preludePromise = esbuild({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    legalComments: 'none',
    plugins: [nodeBuiltinShimPlugin],
    // uuid / nanoid are namespace-only (no default) — the `.default ?? ns`
    // interop below is intentional, so silence the always-undefined warnings.
    logLevel: 'silent'
  }).then((res) => res.outputFiles[0].text)
  return preludePromise
}

/** Minimal polyfills for the browser/host globals a few bundled libs reference
 * at load time but QuickJS (pure ES2020) doesn't provide. Evaluated BEFORE the
 * library bundle so the libs find them. Kept deliberately small — not a full
 * platform, just enough for the curated stdlib to initialise. */
const SANDBOX_SHIMS = `
(function(){
  var g = globalThis;
  if (typeof g.EventTarget === 'undefined') {
    g.EventTarget = function EventTarget(){};
    g.EventTarget.prototype.addEventListener = function(){};
    g.EventTarget.prototype.removeEventListener = function(){};
    g.EventTarget.prototype.dispatchEvent = function(){ return true; };
  }
  if (typeof g.Buffer === 'undefined') {
    // Minimal Buffer: enough for the load-time \`typeof Buffer\` / \`Buffer.isBuffer\`
    // guards a couple of libs (cheerio, xml2js) do. The sandbox works on strings,
    // not real binary, so a structural stand-in is sufficient. \`concat\` does a real
    // Uint8Array join (never silently truncates) — a non-array-like element makes
    // \`.set\` throw loudly rather than dropping data.
    g.Buffer = {
      isBuffer: function(){ return false; },
      from: function(x){ return x; },
      alloc: function(n){ return new Uint8Array(n); },
      isEncoding: function(){ return false; },
      concat: function(list){
        list = list || [];
        var total = 0, i;
        for (i = 0; i < list.length; i++) total += (list[i] && list[i].length) || 0;
        var out = new Uint8Array(total), off = 0;
        for (i = 0; i < list.length; i++) { var c = list[i]; if (c && c.length) { out.set(c, off); off += c.length; } }
        return out;
      }
    };
  }
  if (typeof g.crypto === 'undefined') g.crypto = {};
  if (!g.crypto.getRandomValues) {
    g.crypto.getRandomValues = function(arr){ for (var i=0;i<arr.length;i++) arr[i] = Math.floor(Math.random()*256); return arr; };
  }
  if (typeof g.TextEncoder === 'undefined') {
    g.TextEncoder = function(){};
    g.TextEncoder.prototype.encode = function(str){
      str = String(str); var out = [];
      for (var i=0;i<str.length;i++){ var c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0|(c>>6), 0x80|(c&0x3f));
        else out.push(0xe0|(c>>12), 0x80|((c>>6)&0x3f), 0x80|(c&0x3f)); }
      return new Uint8Array(out);
    };
  }
  if (typeof g.TextDecoder === 'undefined') {
    g.TextDecoder = function(){};
    g.TextDecoder.prototype.decode = function(buf){
      var a = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
      var s = '', i = 0;
      while (i < a.length){ var c = a[i++];
        if (c < 0x80) s += String.fromCharCode(c);
        else if (c < 0xe0) s += String.fromCharCode(((c&0x1f)<<6)|(a[i++]&0x3f));
        else s += String.fromCharCode(((c&0x0f)<<12)|((a[i++]&0x3f)<<6)|(a[i++]&0x3f)); }
      return s;
    };
  }
  if (typeof g.queueMicrotask === 'undefined') g.queueMicrotask = function(cb){ Promise.resolve().then(cb); };
  // setTimeout fires on the next microtask (the delay is ignored — the sandbox
  // has no real event loop, and a deterministic, immediate resolution is what an
  // \`await new Promise(r => setTimeout(r, …))\` actually needs here). setInterval
  // is a no-op so it can never spin forever.
  if (typeof g.setTimeout === 'undefined') {
    g.setTimeout = function(fn){ if (typeof fn === 'function') Promise.resolve().then(function(){ try { fn(); } catch (e) {} }); return 0; };
    g.clearTimeout = function(){};
  }
  if (typeof g.setInterval === 'undefined') { g.setInterval = function(){ return 0; }; g.clearInterval = function(){}; }
})();
`

/** Network surface, evaluated ONLY when a host bridge is supplied. Built on the
 * single async host primitive \`__hostFetch(reqJson) -> Promise<respJson>\`: a
 * browser-ish \`fetch(url, init)\` and a minimal Postman \`pm\` (so a Postman
 * \`pm.sendRequest(...)\` script runs unchanged). Everything here is pure sandbox
 * JS — the host never builds VM objects, only resolves the JSON string. */
const SANDBOX_NETWORK_SHIM = `
(function(){
  var g = globalThis;
  function doFetch(req){
    return g.__hostFetch(JSON.stringify(req)).then(function(s){
      var r = JSON.parse(s);
      if (r.error) throw new Error(r.error);
      return r;
    });
  }
  function normHeaders(h){
    var out = {};
    if (!h) return out;
    if (Array.isArray(h)) { for (var i=0;i<h.length;i++){ var it=h[i]; if(it && it.key) out[String(it.key)] = String(it.value==null?'':it.value); } return out; }
    if (typeof h === 'object') { for (var k in h){ if(Object.prototype.hasOwnProperty.call(h,k)) out[k]=String(h[k]); } }
    return out;
  }
  function bodyToString(b){
    if (b == null) return undefined;
    if (typeof b === 'string') return b;
    if (typeof b === 'object'){
      if (b.mode === 'raw' && typeof b.raw === 'string') return b.raw;
      if (b.raw != null) return String(b.raw);
      try { return JSON.stringify(b); } catch(e){ return String(b); }
    }
    return String(b);
  }
  function headerBag(headers){
    return { get: function(n){ n=String(n).toLowerCase(); for(var k in headers){ if(k.toLowerCase()===n) return headers[k]; } return null; }, raw: headers };
  }
  g.fetch = function(url, init){
    init = init || {};
    var req = { url: String(url), method: String(init.method || 'GET').toUpperCase(), headers: normHeaders(init.headers), body: bodyToString(init.body) };
    return doFetch(req).then(function(r){
      var headers = r.headers || {};
      return {
        status: r.status, statusText: r.statusText || '', ok: r.status >= 200 && r.status < 300,
        url: req.url, headers: headerBag(headers),
        text: function(){ return Promise.resolve(r.body); },
        json: function(){ return Promise.resolve(JSON.parse(r.body)); }
      };
    });
  };
  function makePmResponse(r){
    var headers = r.headers || {};
    return {
      code: r.status, status: r.statusText || '',
      headers: { get: function(n){ n=String(n).toLowerCase(); for(var k in headers){ if(k.toLowerCase()===n) return headers[k]; } return undefined; }, all: function(){ return headers; } },
      text: function(){ return r.body; },
      json: function(){ return JSON.parse(r.body); }
    };
  }
  g.pm = g.pm || {};
  g.pm.expect = g.expect;
  g.pm.response = undefined;
  g.pm.sendRequest = function(reqArg, cb){
    var r = typeof reqArg === 'string' ? { url: reqArg } : (reqArg || {});
    var req = { url: String(r.url), method: String(r.method || 'GET').toUpperCase(), headers: normHeaders(r.header || r.headers), body: bodyToString(r.body) };
    doFetch(req).then(function(resp){
      // Prefer the richer pm-runtime response (with .to.* assertions) when the
      // Postman shim is loaded; fall back to the network-only builder otherwise.
      var pmResp = (typeof g.__makePmResponse === 'function') ? g.__makePmResponse(resp) : makePmResponse(resp);
      g.pm.response = pmResp;
      if (typeof cb === 'function') cb(null, pmResp);
    }, function(err){
      if (typeof cb === 'function') cb(err); else throw err;
    });
  };
})();
`

/** Variable surface, evaluated ONLY when a host variable bridge is supplied.
 * Built on five synchronous host primitives (`__hostGetVar` / `__hostSetVar` /
 * `__hostHasVar` / `__hostDeleteVar` / `__hostVarNames`), it exposes an internal
 * `globalThis.__vars` read/WRITE view of the scenario's run variables. Unlike the
 * read-only `vars` snapshot, writes here persist back to the run — this is the
 * foundation the Postman `pm.*` / Bruno `bru.*` variable scopes build on. Values
 * round-trip as JSON wrapped in `{ v }` so `undefined` survives the boundary. */
const SANDBOX_VARIABLE_SHIM = `
(function(){
  var g = globalThis;
  function get(name){ try { return JSON.parse(g.__hostGetVar(String(name))).v; } catch(e){ return undefined; } }
  function set(name, value){ g.__hostSetVar(String(name), JSON.stringify({ v: value })); return value; }
  function has(name){ return !!g.__hostHasVar(String(name)); }
  function del(name){ g.__hostDeleteVar(String(name)); }
  function keys(){ try { return JSON.parse(g.__hostVarNames()) || []; } catch(e){ return []; } }
  function toObject(){ var o = {}, k = keys(); for (var i=0;i<k.length;i++) o[k[i]] = get(k[i]); return o; }
  function clear(){ var k = keys(); for (var i=0;i<k.length;i++) del(k[i]); }
  g.__vars = { get: get, set: set, has: has, 'delete': del, unset: del, clear: clear, keys: keys, toObject: toObject };
})();
`

/** Postman `pm` runtime, evaluated ONLY when a `postman` context is supplied.
 * Builds the `pm.*` surface so an UNMODIFIED Postman pre/post-request script
 * runs: the variable scopes (`pm.variables`/`environment`/`globals`/
 * `collectionVariables`) all map to the single scenario variable namespace via
 * the P0 `__vars` bridge (so imported scripts interop with native
 * setVariable/getVariable nodes); `pm.request` is the mutable outgoing request;
 * `pm.response` the injected response (post-response scripts) with Postman's
 * `.to.have.status()` / `.to.be.ok` / `.to.have.jsonBody()` / `.to.have.header()`
 * assertions; `pm.test(name, fn)` runs an assertion block and reports PASS/FAIL
 * to the run-log; `pm.expect` is chai. Final `pm.request` mutations + test
 * results + `setNextRequest` are read back via `__pmFinal()` after the run.
 *
 * `pm.sendRequest` / network `pm.response` come from the network shim and are
 * left intact; this shim only (re)builds the non-network surface. */
const SANDBOX_POSTMAN_SHIM = `
(function(){
  var g = globalThis;
  var V = g.__vars;
  function asScope(){
    return {
      get: function(k){ return V.get(String(k)); },
      set: function(k, v){ V.set(String(k), v); return v; },
      has: function(k){ return V.has(String(k)); },
      unset: function(k){ V['delete'](String(k)); },
      clear: function(){ V.clear(); },
      toObject: function(){ return V.toObject(); },
      replaceIn: function(tpl){ return String(tpl).replace(/\\{\\{([^}]+)\\}\\}/g, function(m, n){ var x = V.get(String(n).trim()); return (x===undefined||x===null) ? '' : String(x); }); }
    };
  }
  function headerGet(headers, n){ n=String(n).toLowerCase(); for(var k in headers){ if(Object.prototype.hasOwnProperty.call(headers,k) && k.toLowerCase()===n) return headers[k]; } return undefined; }
  function makeResp(r){
    r = r || {}; var headers = r.headers || {};
    var body = (r.body === undefined || r.body === null) ? '' : String(r.body);
    var resp = {
      code: r.code != null ? r.code : r.status, status: r.status != null ? r.status : (r.statusText || ''),
      responseTime: r.responseTime || 0, responseSize: body.length,
      headers: { get: function(n){ return headerGet(headers, n); }, all: function(){ return headers; }, has: function(n){ return headerGet(headers, n) !== undefined; } },
      text: function(){ return body; },
      json: function(){ return JSON.parse(body); }
    };
    function fail(msg){ var e = new Error(msg); e.name='AssertionError'; throw e; }
    var have = {
      status: function(expected){ if (typeof expected === 'number'){ if (resp.code !== expected) fail('expected response code '+resp.code+' to be '+expected); } else { if (String(resp.status) !== String(expected)) fail('expected response status '+resp.status+' to be '+expected); } return resp.to; },
      header: function(name){ if (!resp.headers.has(name)) fail('expected response to have header '+name); return resp.to; },
      jsonBody: function(){ try { var j = resp.json(); } catch(e){ fail('expected response body to be valid JSON'); } if (arguments.length){ /* deep-eq best effort */ } return resp.to; },
      body: function(expected){ if (expected !== undefined && resp.text() !== String(expected)) fail('expected body to equal '+expected); return resp.to; }
    };
    // Postman asserts on PROPERTY ACCESS for \`.to.be.ok\` (chai-style getter),
    // but \`.to.have.status(code)\` is a method — match both shapes.
    resp.to = {
      have: have,
      be: { get ok(){ if (!(resp.code >= 200 && resp.code < 300)) fail('expected response to be ok, got status '+resp.code); return resp.to; } }
    };
    return resp;
  }
  g.__makePmResponse = makeResp;

  var ctx = g.__pmContext || {};
  g.pm = g.pm || {};
  g.pm.variables = asScope();
  g.pm.environment = asScope();
  g.pm.globals = asScope();
  g.pm.collectionVariables = asScope();
  g.pm.iterationData = { get: function(){ return undefined; }, toObject: function(){ return {}; } };
  g.pm.expect = g.expect;
  g.pm.info = ctx.info || { requestName: '', requestId: '', iteration: 0, iterationCount: 1, eventName: '' };

  // Mutable outgoing request (pre-request scripts edit url/method/headers/body).
  var rq = ctx.request || {};
  g.pm.request = { url: rq.url || '', method: String(rq.method || 'GET'), headers: rq.headers || {}, body: rq.body };

  // Injected response (post-response scripts). Network pm.response (sendRequest)
  // is preserved when no response is injected.
  if (ctx.response) g.pm.response = makeResp(ctx.response);

  // pm.test → run-log + collected results.
  g.__pmTests = [];
  g.pm.test = function(name, fn){
    var rec = { name: String(name), passed: true, error: null };
    try { fn(); } catch(e){ rec.passed = false; rec.error = (e && e.message) ? String(e.message) : String(e); }
    g.__pmTests.push(rec);
    g.console.log((rec.passed ? '\\u2713 ' : '\\u2717 ') + rec.name + (rec.passed ? '' : ' \\u2014 ' + rec.error));
    return rec.passed;
  };
  g.pm.test.skip = function(name){ g.console.log('\\u2298 ' + String(name) + ' (skipped)'); };

  // Flow control → read back, mapped to a control edge by the importer.
  g.__pmNext = undefined;
  function setNext(n){ g.__pmNext = (n === null ? null : String(n)); }
  g.pm.setNextRequest = setNext;
  g.pm.execution = g.pm.execution || {};
  g.pm.execution.setNextRequest = setNext;
  g.pm.execution.skipRequest = function(){ g.__pmNext = '\\u0000skip'; };
  g.pm.execution.location = ctx.location || [];

  // Historical Postman global alias.
  g.postman = g.postman || {};
  g.postman.setNextRequest = setNext;
  g.postman.getResponseHeader = function(n){ return g.pm.response ? g.pm.response.headers.get(n) : undefined; };

  // Final state read back by the host after the script runs.
  g.__pmFinal = function(){ return JSON.stringify({ request: g.pm.request, tests: g.__pmTests, nextRequest: g.__pmNext, runRequest: g.__pmRunRequest }); };
})();
`

/** Bruno `bru` / `req` / `res` runtime, evaluated ONLY when a `bruno` context is
 * supplied. Loaded AFTER the Postman shim (Bruno ships a `pm` compat layer), it
 * reuses the shared mutable request (`pm.request`), injected response
 * (`pm.response`) and test/next-request collectors — so `__pmFinal()` reads the
 * outcome back identically. Variable scopes all map to the scenario namespace
 * via `__vars`, so imported Bruno scripts interop with native variable nodes. */
const SANDBOX_BRUNO_SHIM = `
(function(){
  var g = globalThis;
  var V = g.__vars;
  var rq = g.pm.request;
  var info = (g.__pmContext || {}).info || {};
  function hget(h, n){ n=String(n).toLowerCase(); for(var k in h){ if(Object.prototype.hasOwnProperty.call(h,k) && k.toLowerCase()===n) return h[k]; } return undefined; }
  g.bru = {
    getVar: function(k){ return V.get(String(k)); },
    setVar: function(k, v){ V.set(String(k), v); },
    deleteVar: function(k){ V['delete'](String(k)); },
    getEnvVar: function(k){ return V.get(String(k)); },
    setEnvVar: function(k, v){ V.set(String(k), v); },
    hasEnvVar: function(k){ return V.has(String(k)); },
    deleteEnvVar: function(k){ V['delete'](String(k)); },
    getCollectionVar: function(k){ return V.get(String(k)); },
    getFolderVar: function(k){ return V.get(String(k)); },
    getRequestVar: function(k){ return V.get(String(k)); },
    getProcessEnv: function(){ return undefined; },
    getEnvName: function(){ return info.envName || ''; },
    getCollectionName: function(){ return info.collectionName || ''; },
    setNextRequest: function(n){ g.__pmNext = (n === null ? null : String(n)); },
    runRequest: function(p){ g.__pmRunRequest = String(p); return Promise.resolve(undefined); },
    sleep: function(ms){ return new Promise(function(r){ g.setTimeout(r, ms); }); },
    disableParsingResponseJson: function(){},
    cwd: function(){ return ''; },
    runner: {
      setNextRequest: function(n){ g.__pmNext = (n === null ? null : String(n)); },
      stopExecution: function(){ g.__pmNext = '\\u0000stop'; },
      skipRequest: function(){ g.__pmNext = '\\u0000skip'; }
    }
  };
  g.req = {
    getUrl: function(){ return rq.url; }, setUrl: function(u){ rq.url = String(u); },
    getMethod: function(){ return rq.method; }, setMethod: function(m){ rq.method = String(m); },
    getHeader: function(n){ return hget(rq.headers, n); },
    getHeaders: function(){ return rq.headers; },
    setHeader: function(n, v){ rq.headers[String(n)] = String(v); },
    setHeaders: function(h){ rq.headers = h || {}; },
    getBody: function(){ return rq.body; }, setBody: function(b){ rq.body = b; },
    getAuthMode: function(){ return (rq.auth && rq.auth.mode) || 'none'; },
    getTimeout: function(){ return rq.timeout || 0; }, setTimeout: function(t){ rq.timeout = t; },
    setMaxRedirects: function(n){ rq.maxRedirects = n; },
    getName: function(){ return rq.name || ''; },
    disableParsingResponseJson: function(){}
  };
  var resp = g.pm.response;
  g.res = resp ? {
    getStatus: function(){ return resp.code; },
    getStatusText: function(){ return resp.status; },
    getHeader: function(n){ return resp.headers.get(n); },
    getHeaders: function(){ return resp.headers.all(); },
    getBody: function(){ try { return resp.json(); } catch(e){ return resp.text(); } },
    setBody: function(b){ resp.__body = b; },
    getResponseTime: function(){ return resp.responseTime; }
  } : undefined;
  // Bruno's global \`test()\` shares the pm collector; expect/assert are chai.
  g.test = g.pm.test;
})();
`

/** A network request the sandbox asks the trusted host to perform on its behalf
 * (so it goes through restorm's firewall instead of a parallel HTTP stack). */
export interface SandboxHttpRequest {
  url: string
  method: string
  headers: Record<string, string>
  /** Serialized request body (string), or undefined for none. */
  body?: string
}

/** The serialized response handed back to the sandbox. A transport/firewall
 * failure is reported as `error` (the sandbox shim turns it into a throw) rather
 * than rejecting, so a denied host surfaces as a clean in-sandbox Error. */
export interface SandboxHttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  /** Response body as text. */
  body: string
  /** Set when the request could not complete (firewall denial, DNS, abort…). */
  error?: string
}

/** Performs an HTTP request from the trusted host. Injected by the executor so
 * the sandbox never holds a real network primitive; the host routes it through
 * the firewall-instrumented HTTP layer. `signal` aborts an in-flight request
 * when the run ends (timeout / completion). */
export type SandboxNetworkBridge = (req: SandboxHttpRequest, signal: AbortSignal) => Promise<SandboxHttpResponse>

/** Read/WRITE access to the scenario run's variables from inside the sandbox.
 * Backed by the executor's live variable map, so a script that writes a variable
 * (via `pm.environment.set` / `bru.setVar` / the internal `__vars`) persists it
 * to the run — the bridge the imported Postman/Bruno scripts need to pass state
 * between requests. All values are JSON-cloneable (functions/dates are dropped),
 * matching how `setVariable` / `getVariable` nodes already store them. */
export interface SandboxVariableBridge {
  get(name: string): unknown
  set(name: string, value: unknown): void
  has(name: string): boolean
  delete(name: string): void
  /** The names of every variable currently set (for `toObject` / `clear`). */
  names(): string[]
}

export interface RunCodeOptions {
  /** The user's TypeScript/JavaScript source (treated as a function body that
   * may `return` the result). */
  code: string
  /** The node's wired/inline input value, exposed as the `input` global. */
  input?: unknown
  /** Run variables, exposed as the `vars` global (a plain object). */
  variables?: Record<string, unknown>
  /** Wall-clock execution budget; a runaway script is interrupted after it. */
  timeoutMs?: number
  /** Optional host network bridge. When provided, the sandbox gains `fetch(...)`
   * and a minimal Postman `pm` (`pm.sendRequest` / `pm.response` / `pm.expect`)
   * that delegate to it — and thus to the firewall. Absent → the sandbox stays
   * fully offline (no `fetch`, no `pm`), the safe default. */
  network?: SandboxNetworkBridge
  /** Optional host variable bridge. When provided, the sandbox gains an internal
   * `__vars` read/WRITE view of the run's variables (the foundation `pm.*` /
   * `bru.*` variable scopes build on). Absent → the script only sees the
   * read-only `vars` snapshot. */
  variableBridge?: SandboxVariableBridge
  /** Optional Postman context. When provided, the sandbox builds the `pm.*`
   * runtime so an unmodified Postman pre/post-request script runs (variables,
   * `pm.test`, `pm.request`/`pm.response`, `setNextRequest`). Requires
   * `variableBridge` for the variable scopes. Pre/post mutations + test results
   * come back on {@link RunCodeResult.postman}. */
  postman?: SandboxScriptContext
  /** Optional Bruno context. Like {@link postman} but builds the Bruno
   * `bru`/`req`/`res` runtime (plus Bruno's `pm` compat layer) so an unmodified
   * Bruno script runs. Mutually exclusive with `postman`; outcome also on
   * {@link RunCodeResult.postman}. */
  bruno?: SandboxScriptContext
  /** The run's cooperative-cancellation signal (user Stop / scope abort). When
   * it fires, any in-flight host network request is aborted immediately rather
   * than lingering until the wall-clock timeout. */
  signal?: AbortSignal
}

/** The request/response/info context fed to a Postman (`pm`) or Bruno
 * (`bru`/`req`/`res`) script — the outgoing request a pre-request script may
 * mutate, the response a post-response script reads, and runner metadata. */
export interface SandboxScriptContext {
  /** The outgoing request (pre-request scripts mutate it). */
  request?: { url?: string; method?: string; headers?: Record<string, string>; body?: unknown; name?: string; auth?: unknown }
  /** The response (post-response scripts read it). */
  response?: { code?: number; status?: number; statusText?: string; headers?: Record<string, string>; body?: string; responseTime?: number }
  /** Runner metadata (`pm.info` / Bruno equivalents). */
  info?: Record<string, unknown>
  /** Runner location array (`pm.execution.location`). */
  location?: unknown[]
}

/** What a Postman/Bruno script changed: the (possibly mutated) outgoing request,
 * the `pm.test`/`test()` results, and a `setNextRequest` target (→ control edge
 * by the importer). `nextRequest === null` clears it; `' skip'` = skip. */
export interface SandboxScriptOutcome {
  request?: SandboxScriptContext['request']
  tests?: { name: string; passed: boolean; error: string | null }[]
  nextRequest?: string | null
  /** A Bruno `bru.runRequest(path)` target (→ a runScenario/httpRequest edge). */
  runRequest?: string
}

export interface RunCodeResult {
  /** The value returned by the user code (JSON-cloneable). */
  result: unknown
  /** Anything the script wrote via `console.log(...)`. */
  logs: string[]
  /** Present when a `postman` (or `bruno`) context was supplied: the script's
   * request mutations, test results and `setNextRequest`. */
  postman?: SandboxScriptOutcome
}

/** Transpile + run user code in the QuickJS sandbox. Rejects with a normal
 * Error (message from the sandboxed throw) on a script error or timeout. */
export async function runCodeInSandbox(opts: RunCodeOptions): Promise<RunCodeResult> {
  const { code, input, variables = {}, timeoutMs = 5000, network, variableBridge, postman, bruno, signal } = opts
  // A Postman or Bruno script shares one request/response/test context.
  const scriptCtx = postman ?? bruno
  // 1. Transpile TS -> JS (types stripped; isolatedModules-safe single file).
  // Wrap as an ASYNC function body BEFORE transpiling, so esbuild sees the
  // top-level `await` / `return` inside a function (valid) instead of at module
  // scope (an error). The result is `(async () => { … })()` — a QuickJS promise.
  const wrappedSource = `(async function(){\n${code}\n})()`
  const transpiled = (await esbuildTransform(wrappedSource, { loader: 'ts', target: 'es2020' })).code
  const prelude = await getStdlibPrelude()

  const QuickJS = await getQuickJS()
  const ctx: QuickJSContext = QuickJS.newContext()
  const logs: string[] = []
  // Aborts any in-flight host network request when the run ends (timeout or
  // completion) — so a sandbox that fires a slow `fetch` and then times out
  // doesn't leak a request that outlives it.
  const netAbort = network ? new AbortController() : null
  // Forward the run's cancellation (user Stop) to the in-flight host request, so
  // a slow `fetch` is cut loose at once instead of running out the full timeout.
  const onRunAbort = (): void => { netAbort?.abort() }
  if (netAbort && signal) {
    if (signal.aborted) netAbort.abort()
    else signal.addEventListener('abort', onRunAbort, { once: true })
  }
  // Set once the context is torn down (timeout / completion). A host network
  // request that resolves AFTER teardown must not touch the dead context (its
  // `newString` / `resolve` / `executePendingJobs` would throw, surfacing as an
  // unhandled main-process rejection) — every post-await VM touch checks this.
  let disposed = false
  try {
    // console.log bridge: collect into `logs`.
    const consoleHandle = ctx.newObject()
    const logFn = ctx.newFunction('log', (...args) => {
      logs.push(args.map((a): string => { const v: unknown = ctx.dump(a); return typeof v === 'string' ? v : safeJson(v) }).join(' '))
    })
    ctx.setProp(consoleHandle, 'log', logFn)
    ctx.setProp(consoleHandle, 'info', logFn)
    ctx.setProp(consoleHandle, 'warn', logFn)
    ctx.setProp(consoleHandle, 'error', logFn)
    ctx.setProp(ctx.global, 'console', consoleHandle)
    consoleHandle.dispose()
    logFn.dispose()

    // 2. Global shims, then the standard library prelude.
    const shim = ctx.evalCode(SANDBOX_SHIMS)
    if (shim.error) { const e: unknown = ctx.dump(shim.error); shim.error.dispose(); throw new Error(`sandbox shims failed: ${stringifyErr(e)}`) }
    shim.value.dispose()

    const pre = ctx.evalCode(prelude)
    if (pre.error) { const e: unknown = ctx.dump(pre.error); pre.error.dispose(); throw new Error(`sandbox prelude failed: ${stringifyErr(e)}`) }
    pre.value.dispose()

    // 2b. Network bridge (only when a host bridge is supplied): expose the single
    //     async host primitive `__hostFetch(reqJson) -> Promise<respJson>`, then
    //     eval the shim that builds `fetch` / `pm` on top of it. The host work
    //     runs on the Node event loop; resolving the VM promise + pumping the job
    //     queue (`promise.settled.then(executePendingJobs)`) is what lets a
    //     sandbox `await fetch(...)` resume. The bridge routes through the
    //     firewall, so a denied host comes back as `{ error }` → an in-sandbox throw.
    if (network && netAbort) {
      const hostFetchFn = ctx.newFunction('__hostFetch', (reqHandle) => {
        const promise = ctx.newPromise()
        // Resolve the VM promise with a JSON string — but only if the context is
        // still alive. If the run already timed out / completed, the host result
        // is irrelevant and touching `ctx` would throw on a disposed runtime.
        const settle = (json: string): void => {
          if (disposed) return
          const s = ctx.newString(json)
          promise.resolve(s)
          s.dispose()
        }
        let parsed: SandboxHttpRequest | null = null
        try { parsed = JSON.parse(ctx.getString(reqHandle)) as SandboxHttpRequest } catch { parsed = null }
        if (!parsed || typeof parsed.url !== 'string') {
          settle(JSON.stringify({ error: 'invalid sandbox network request' }))
        } else {
          network(parsed, netAbort.signal).then(
            (resp) => { settle(safeJson(resp)) },
            (err: unknown) => { settle(JSON.stringify({ error: errMessage(err) })) }
          )
        }
        void promise.settled.then(() => { if (!disposed) ctx.runtime.executePendingJobs() })
        return promise.handle
      })
      ctx.setProp(ctx.global, '__hostFetch', hostFetchFn)
      hostFetchFn.dispose()

      const net = ctx.evalCode(SANDBOX_NETWORK_SHIM)
      if (net.error) { const e: unknown = ctx.dump(net.error); net.error.dispose(); throw new Error(`sandbox network shim failed: ${stringifyErr(e)}`) }
      net.value.dispose()
    }

    // 2c. Variable bridge (only when supplied): five synchronous host primitives
    //     backing an internal `__vars` read/WRITE view of the run's variables.
    //     Values cross the boundary as JSON wrapped in `{ v }` so `undefined`
    //     survives. Writes mutate the executor's live variable map at once, so a
    //     script can pass state to a later node (what imported pm/bru scripts do).
    if (variableBridge) {
      const getVarFn = ctx.newFunction('__hostGetVar', (nameH) =>
        ctx.newString(safeJson({ v: variableBridge.get(ctx.getString(nameH)) })))
      ctx.setProp(ctx.global, '__hostGetVar', getVarFn); getVarFn.dispose()

      const setVarFn = ctx.newFunction('__hostSetVar', (nameH, valH) => {
        let value: unknown
        try { value = (JSON.parse(ctx.getString(valH)) as { v: unknown }).v } catch { value = undefined }
        variableBridge.set(ctx.getString(nameH), value)
      })
      ctx.setProp(ctx.global, '__hostSetVar', setVarFn); setVarFn.dispose()

      const hasVarFn = ctx.newFunction('__hostHasVar', (nameH) =>
        variableBridge.has(ctx.getString(nameH)) ? ctx.true : ctx.false)
      ctx.setProp(ctx.global, '__hostHasVar', hasVarFn); hasVarFn.dispose()

      const delVarFn = ctx.newFunction('__hostDeleteVar', (nameH) => { variableBridge.delete(ctx.getString(nameH)) })
      ctx.setProp(ctx.global, '__hostDeleteVar', delVarFn); delVarFn.dispose()

      const namesFn = ctx.newFunction('__hostVarNames', () => ctx.newString(safeJson(variableBridge.names())))
      ctx.setProp(ctx.global, '__hostVarNames', namesFn); namesFn.dispose()

      const vars = ctx.evalCode(SANDBOX_VARIABLE_SHIM)
      if (vars.error) { const e: unknown = ctx.dump(vars.error); vars.error.dispose(); throw new Error(`sandbox variable shim failed: ${stringifyErr(e)}`) }
      vars.value.dispose()
    }

    // 2d. Postman / Bruno runtime (when a script context is supplied): inject the
    //     request/response/info context, build the `pm.*` surface on top of
    //     `__vars` (P0) + the network shim, then — for Bruno — the `bru`/`req`/
    //     `res` surface on top of the shared pm state. Requires the variable bridge.
    if (scriptCtx) {
      const pmCtx = ctx.evalCode(`globalThis.__pmContext = ${safeJson(scriptCtx)};`)
      if (pmCtx.error) { const e: unknown = ctx.dump(pmCtx.error); pmCtx.error.dispose(); throw new Error(`sandbox script context failed: ${stringifyErr(e)}`) }
      pmCtx.value.dispose()
      const pmShim = ctx.evalCode(SANDBOX_POSTMAN_SHIM)
      if (pmShim.error) { const e: unknown = ctx.dump(pmShim.error); pmShim.error.dispose(); throw new Error(`sandbox pm shim failed: ${stringifyErr(e)}`) }
      pmShim.value.dispose()
      if (bruno) {
        const bruShim = ctx.evalCode(SANDBOX_BRUNO_SHIM)
        if (bruShim.error) { const e: unknown = ctx.dump(bruShim.error); bruShim.error.dispose(); throw new Error(`sandbox bru shim failed: ${stringifyErr(e)}`) }
        bruShim.value.dispose()
      }
    }

    // 3. Inject input + variables as JSON (data only — no functions/dates).
    const injected = `globalThis.input = ${safeJson(input)}; globalThis.vars = ${safeJson(variables)};`
    const inj = ctx.evalCode(injected)
    if (inj.error) { const e: unknown = ctx.dump(inj.error); inj.error.dispose(); throw new Error(`sandbox input injection failed: ${stringifyErr(e)}`) }
    inj.value.dispose()

    // 4. Run the user code as an ASYNC function body so it may `await`. Arm the
    //    interrupt deadline HERE — bounding ONLY the user code — so the trusted
    //    shim + stdlib prelude eval (sizeable now the libs are bundled) can't eat
    //    into the user's timeout budget (otherwise a heavy prelude on a loaded host
    //    fires the interrupt mid-setup, surfacing as a bogus "prelude failed").
    //    The result is a QuickJS promise; settle it (draining the job queue) and
    //    dump its value. A pure-JS await resolves via the pumped microtask queue; a
    //    never-settling await is bounded by the wall-clock timeout below.
    ctx.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs))
    const out = ctx.evalCode(transpiled)
    if (out.error) { const e: unknown = ctx.dump(out.error); out.error.dispose(); throw new Error(stringifyErr(e)) }
    const settled = await settlePromise(ctx, out.value, timeoutMs)
    const result: unknown = ctx.dump(settled)
    settled.dispose()
    // Read back the Postman/Bruno script outcome (mutated request, test results,
    // setNextRequest) — the script ran, so `__pmFinal()` is defined.
    if (scriptCtx) {
      const finalRes = ctx.evalCode('__pmFinal()')
      if (!finalRes.error) {
        const raw: unknown = ctx.dump(finalRes.value)
        finalRes.value.dispose()
        try { return { result, logs, postman: JSON.parse(String(raw)) as SandboxScriptOutcome } } catch { /* fall through */ }
      } else { finalRes.error.dispose() }
    }
    return { result, logs }
  } finally {
    // Mark the context dead BEFORE disposing, so any host network callback that
    // settles after this point short-circuits instead of touching dead handles.
    disposed = true
    // Cut any in-flight host request loose (timeout or normal completion) and
    // detach the run-abort listener so it can't accumulate across code nodes.
    if (signal) signal.removeEventListener('abort', onRunAbort)
    netAbort?.abort()
    // A timed-out async run can leave QuickJS promise handles undisposed, which
    // makes dispose() throw — that's fine, the whole context is being torn down.
    try { ctx.dispose() } catch { /* leaked handles on timeout */ }
  }
}

/** Message from an unknown thrown value (Error, string, …). */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  const s = safeJson(err)
  return s === 'undefined' ? 'network request failed' : s
}

/** Settle a QuickJS promise: pump the job queue so pure-JS microtasks/promises
 * resolve, then await the result on the host — racing a wall-clock timeout so a
 * promise that never settles (e.g. `await new Promise(() => {})`) can't hang. */
async function settlePromise(ctx: QuickJSContext, promiseHandle: QuickJSHandle, timeoutMs: number): Promise<QuickJSHandle> {
  const resolved = ctx.resolvePromise(promiseHandle)
  promiseHandle.dispose()
  ctx.runtime.executePendingJobs()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('code execution timed out')) }, timeoutMs) })
  try {
    const result = await Promise.race([resolved, timeout])
    ctx.runtime.executePendingJobs()
    if (result.error) { const e: unknown = ctx.dump(result.error); result.error.dispose(); throw new Error(stringifyErr(e)) }
    return result.value
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** JSON for injection; `undefined` becomes `undefined` (a valid JS literal). */
function safeJson(v: unknown): string {
  if (v === undefined) return 'undefined'
  try { const s = JSON.stringify(v); return typeof s === 'string' ? s : 'undefined' } catch { return 'undefined' }
}

/** Render a dumped QuickJS error (object with name/message or a primitive). */
function stringifyErr(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as { name?: string; message?: string; stack?: string }
    if (o.message) return o.name ? `${o.name}: ${o.message}` : o.message
    const s = safeJson(e)
    return s === 'undefined' ? 'error' : s
  }
  return safeJson(e) === 'undefined' ? String(e as number | boolean) : safeJson(e)
}
