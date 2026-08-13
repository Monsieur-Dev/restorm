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
 * The curated standard library (see `sandboxStdlib`) is a single IIFE that
 * defines the libs as globals + a `require()` shim, evaluated in the QuickJS
 * context before the user code — loaded from the build-time asset in packaged
 * installs, bundled once on the fly in dev. Mirrors the Postman/Bruno built-ins.
 */

import { transform as esbuildTransform } from 'esbuild'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildStdlibPrelude } from './sandboxStdlib'
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten'
import type { PackageSpec } from './codeRuntimes/types'

/** Packaged installs load the prelude generated at build time
 * (`scripts/generate-sandbox-prelude.mts` → `restorm-resources/`): the esbuild
 * binary is a separate process that sees `app.asar` as a plain file, so it can
 * never resolve the curated packages from inside the archive. Overridable via
 * `RESTORM_SANDBOX_PRELUDE_PATH` (tests, debugging). */
function preludeAssetCandidates(): string[] {
  const candidates: string[] = []
  const override = process.env.RESTORM_SANDBOX_PRELUDE_PATH
  if (override !== undefined && override !== '') candidates.push(override)
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    candidates.push(join(resourcesPath, 'restorm-resources/sandbox-stdlib-prelude.js'))
  }
  return candidates
}

/** Load (once) the standard-library prelude: the pre-generated asset when one
 * exists (packaged installs, or an explicit override), else bundled on the fly
 * from node_modules (dev / tests, where a real checkout is on disk). The first
 * resolution is frozen for the process lifetime — changing
 * `RESTORM_SANDBOX_PRELUDE_PATH` afterwards needs a fresh module instance
 * (tests: `vi.resetModules()`). */
let preludePromise: Promise<string> | null = null
function getStdlibPrelude(): Promise<string> {
  if (preludePromise) return preludePromise
  preludePromise = (async () => {
    for (const candidate of preludeAssetCandidates()) {
      if (existsSync(candidate)) return readFile(candidate, 'utf8')
    }
    return buildStdlibPrelude()
  })()
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
    function deepEq(a, b){
      if (a === b) return true;
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var i = 0; i < ka.length; i++){ if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEq(a[ka[i]], b[ka[i]])) return false; }
      return true;
    }
    var have = {
      status: function(expected){ if (typeof expected === 'number'){ if (resp.code !== expected) fail('expected response code '+resp.code+' to be '+expected); } else { if (String(resp.status) !== String(expected)) fail('expected response status '+resp.status+' to be '+expected); } return resp.to; },
      header: function(name){ if (!resp.headers.has(name)) fail('expected response to have header '+name); return resp.to; },
      jsonBody: function(expected){ var j; try { j = resp.json(); } catch(e){ fail('expected response body to be valid JSON'); } if (arguments.length && !deepEq(j, expected)) fail('expected response json to deep-equal the expected value'); return resp.to; },
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
  // pm.iterationData: data-driven runs. Backed by the script context's
  // iterationData (the wired input row when it's a plain object), so a
  // collection that reads pm.iterationData.get('field') gets the current row.
  var __iter = (ctx.iterationData && typeof ctx.iterationData === 'object') ? ctx.iterationData : {};
  g.pm.iterationData = {
    get: function(k){ return __iter[String(k)]; },
    has: function(k){ return Object.prototype.hasOwnProperty.call(__iter, String(k)); },
    toObject: function(){ var o = {}; for (var k in __iter){ if (Object.prototype.hasOwnProperty.call(__iter, k)) o[k] = __iter[k]; } return o; }
  };
  g.pm.expect = g.expect;
  g.pm.info = ctx.info || { requestName: '', requestId: '', iteration: 0, iterationCount: 1, eventName: '' };

  // pm.vault: an async secret store. restorm has no separate vault, so it is
  // backed by the scenario variable namespace under a \`vault:\` prefix — get/set
  // round-trip, and a script awaiting pm.vault.get(...) runs unchanged.
  g.pm.vault = {
    get: function(k){ return Promise.resolve(V.get('vault:' + String(k))); },
    set: function(k, val){ V.set('vault:' + String(k), val); return Promise.resolve(); },
    unset: function(k){ V['delete']('vault:' + String(k)); return Promise.resolve(); }
  };

  // pm.visualizer.set(template, data): capture the visualizer payload (read back
  // via __pmFinal) and surface a run-log line, so a script that renders a
  // visualization runs without error.
  g.__pmVisualizer = undefined;
  g.pm.visualizer = {
    set: function(template, data){ g.__pmVisualizer = { template: String(template == null ? '' : template), data: (data === undefined ? null : data) }; g.console.log('\\u2261 visualizer set (' + String(template == null ? '' : template).length + ' chars)'); },
    clear: function(){ g.__pmVisualizer = undefined; }
  };

  // pm.cookies + pm.cookies.jar() — an in-sandbox cookie store (per script run;
  // restorm has no cross-request cookie jar yet). Both the sync accessors and
  // the callback-style jar API are supported so a script that reads/sets cookies
  // runs unchanged.
  var __cookies = {};
  function cookieList(){ var a = []; for (var k in __cookies){ if (Object.prototype.hasOwnProperty.call(__cookies, k)) a.push({ name: k, value: __cookies[k] }); } return a; }
  g.pm.cookies = {
    get: function(n){ return __cookies[String(n)]; },
    has: function(n){ return Object.prototype.hasOwnProperty.call(__cookies, String(n)); },
    toObject: function(){ var o = {}; for (var k in __cookies){ if (Object.prototype.hasOwnProperty.call(__cookies, k)) o[k] = __cookies[k]; } return o; },
    all: cookieList,
    jar: function(){
      return {
        get: function(url, name, cb){ var v = __cookies[String(name)]; if (typeof cb === 'function') cb(null, v); return v; },
        set: function(url, name, value, cb){ __cookies[String(name)] = String((value && typeof value === 'object') ? (value.value != null ? value.value : '') : value); if (typeof cb === 'function') cb(null); },
        getAll: function(url, cb){ var l = cookieList(); if (typeof cb === 'function') cb(null, l); return l; },
        unset: function(url, name, cb){ delete __cookies[String(name)]; if (typeof cb === 'function') cb(null); },
        clear: function(url, cb){ __cookies = {}; if (typeof cb === 'function') cb(null); }
      };
    }
  };

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
  g.__pmFinal = function(){ return JSON.stringify({ request: g.pm.request, tests: g.__pmTests, nextRequest: g.__pmNext, runRequest: g.__pmRunRequest, visualizer: g.__pmVisualizer }); };
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
    runRequest: function(name){
      g.__pmRunRequest = String(name);
      if (typeof g.__hostRunRequest === 'function') {
        return g.__hostRunRequest(String(name)).then(function(s){
          var r = JSON.parse(s);
          if (r.error) throw new Error(r.error);
          return (typeof g.__makePmResponse === 'function') ? g.__makePmResponse(r) : r;
        });
      }
      return Promise.resolve(undefined);
    },
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
  function resBody(){ try { return resp.json(); } catch(e){ return resp.text(); } }
  g.res = resp ? {
    getStatus: function(){ return resp.code; },
    getStatusText: function(){ return resp.status; },
    getHeader: function(n){ return resp.headers.get(n); },
    getHeaders: function(){ return resp.headers.all(); },
    getBody: resBody,
    setBody: function(b){ resp.__body = b; },
    getResponseTime: function(){ return resp.responseTime; },
    // Bruno's vars/assert expressions read these as PROPERTIES (res.status,
    // res.body, …), not via getX() — expose both shapes.
    status: resp.code,
    statusText: resp.status,
    headers: resp.headers.all(),
    body: resBody(),
    responseTime: resp.responseTime
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
  /** Optional host bridge for Bruno's `bru.runRequest(name)`: resolve a request
   * by name in the collection, execute it, and resolve to its response. When
   * absent, `bru.runRequest` just records the target (mapped to an edge later). */
  runRequest?: (name: string, signal: AbortSignal) => Promise<SandboxHttpResponse>
  /** The node's pinned external packages (`config.packages`), already fetched +
   * esbuild-bundled into `packagesCacheDir` by the executor's `installPackages`
   * call — this only INJECTS the cached bundles, it never bundles here. Built
   * into a second prelude evaluated after the (cached, singleton) curated
   * stdlib prelude; unlike that singleton, this one is rebuilt fresh on every
   * run from THIS node's packages, since different nodes pin different sets. */
  packages?: PackageSpec[]
  /** The runtime's per-language cache root holding {@link packages}' bundles
   * (set together with `packages`; see `CodeRunContext.packagesCacheDir`). */
  packagesCacheDir?: string
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
  /** Data-driven iteration row (`pm.iterationData`) — the current input row a
   * data-driven collection reads via `pm.iterationData.get(...)`. */
  iterationData?: Record<string, unknown>
}

// Re-exported from a dependency-free module so consumers (e.g. the `code`
// executor, and therefore the whole scheduler) can read the sentinel WITHOUT
// importing this file — which statically pulls esbuild/QuickJS and would break
// scheduler unit tests under jsdom.
export { SKIP_REQUEST_SENTINEL } from './scriptSentinels'

/** What a Postman/Bruno script changed: the (possibly mutated) outgoing request,
 * the `pm.test`/`test()` results, and a `setNextRequest` target (→ control edge
 * by the importer). `nextRequest === null` clears it; `' skip'` = skip. */
export interface SandboxScriptOutcome {
  request?: SandboxScriptContext['request']
  tests?: { name: string; passed: boolean; error: string | null }[]
  nextRequest?: string | null
  /** A Bruno `bru.runRequest(path)` target (→ a runScenario/httpRequest edge). */
  runRequest?: string
  /** A `pm.visualizer.set(template, data)` payload, captured for the run-log. */
  visualizer?: { template: string; data: unknown }
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
  const { code, input, variables = {}, timeoutMs = 5000, network, variableBridge, postman, bruno, runRequest, packages, packagesCacheDir, signal } = opts
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
  const netAbort = (network || runRequest) ? new AbortController() : null
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

    // 2a. User-pinned npm packages (only when the node has `config.packages`):
    //     a SECOND prelude, evaluated AFTER the stdlib one so it can layer on
    //     top of (never replace) the curated globals/require() — see
    //     codeRuntimes/npmBundle.ts. Bundling already happened at install time;
    //     this only reads + injects the cached `bundle.js` files.
    if (packages && packages.length > 0 && packagesCacheDir) {
      const { buildUserPackagesPrelude } = await import('./codeRuntimes/npmBundle')
      const userPrelude = buildUserPackagesPrelude(packagesCacheDir, packages)
      const userPre = ctx.evalCode(userPrelude)
      if (userPre.error) { const e: unknown = ctx.dump(userPre.error); userPre.error.dispose(); throw new Error(`sandbox user packages failed: ${stringifyErr(e)}`) }
      userPre.value.dispose()
    }

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

    // `bru.runRequest(name)` host bridge: resolve + execute a request by name on
    // the host, resolve the VM promise with its response (same async plumbing as
    // `__hostFetch`). The bru shim wraps it into a pm-style response object.
    if (runRequest && netAbort) {
      const runReqFn = ctx.newFunction('__hostRunRequest', (nameHandle) => {
        const promise = ctx.newPromise()
        const settle = (json: string): void => {
          if (disposed) return
          const s = ctx.newString(json)
          promise.resolve(s)
          s.dispose()
        }
        const name = ctx.getString(nameHandle)
        runRequest(name, netAbort.signal).then(
          (resp) => { settle(safeJson(resp)) },
          (err: unknown) => { settle(JSON.stringify({ error: errMessage(err) })) }
        )
        void promise.settled.then(() => { if (!disposed) ctx.runtime.executePendingJobs() })
        return promise.handle
      })
      ctx.setProp(ctx.global, '__hostRunRequest', runReqFn)
      runReqFn.dispose()
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
      // Cross the (attacker-influenceable) request/response context as VM string
      // data parsed by the VM's JSON.parse — never compiled into source — so a
      // crafted response body can't break out of a string literal.
      defineJsonGlobal(ctx, '__pmContext', scriptCtx)
      const pmShim = ctx.evalCode(SANDBOX_POSTMAN_SHIM)
      if (pmShim.error) { const e: unknown = ctx.dump(pmShim.error); pmShim.error.dispose(); throw new Error(`sandbox pm shim failed: ${stringifyErr(e)}`) }
      pmShim.value.dispose()
      if (bruno) {
        const bruShim = ctx.evalCode(SANDBOX_BRUNO_SHIM)
        if (bruShim.error) { const e: unknown = ctx.dump(bruShim.error); bruShim.error.dispose(); throw new Error(`sandbox bru shim failed: ${stringifyErr(e)}`) }
        bruShim.value.dispose()
      }
    }

    // 3. Inject input + variables as JSON DATA (no functions/dates), crossed as
    //    VM strings and parsed in-VM rather than interpolated into source — so an
    //    attacker-influenced value can't escape its string literal.
    defineJsonGlobal(ctx, 'input', input)
    defineJsonGlobal(ctx, 'vars', variables)

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

/**
 * Assign `globalThis[propName] = <value>` inside the VM WITHOUT compiling the
 * value into source. The value's JSON crosses the boundary as VM *string data*
 * and is parsed by the VM's own `JSON.parse`, so an attacker-influenced string
 * (a response body, an imported script context) can never break out of a
 * source-level string literal — closing the U+2028/U+2029 and string-literal
 * escape gaps that `evalCode(\`x = ${json}\`)` left open. `undefined` is set
 * directly (no JSON round-trip). Throws on a VM-side failure.
 */
function defineJsonGlobal(ctx: QuickJSContext, propName: string, value: unknown): void {
  if (value === undefined) {
    ctx.setProp(ctx.global, propName, ctx.undefined)
    return
  }
  const json = safeJson(value)
  const jsonHandle = ctx.newString(json)
  const parseFn = ctx.getProp(ctx.global, 'JSON').consume((jsonObj) => ctx.getProp(jsonObj, 'parse'))
  try {
    const parsed = ctx.callFunction(parseFn, ctx.undefined, jsonHandle)
    if (parsed.error) {
      const e: unknown = ctx.dump(parsed.error); parsed.error.dispose()
      throw new Error(`sandbox JSON injection failed for "${propName}": ${stringifyErr(e)}`)
    }
    ctx.setProp(ctx.global, propName, parsed.value)
    parsed.value.dispose()
  } finally {
    parseFn.dispose()
    jsonHandle.dispose()
  }
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
