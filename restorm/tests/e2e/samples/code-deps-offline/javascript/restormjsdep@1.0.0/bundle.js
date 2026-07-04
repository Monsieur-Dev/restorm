// Tiny zero-dependency pure-JS package, committed as an offline e2e fixture for
// the code-node external-dependencies chain (no live npm registry).
//
// The JS/TS runtime caches the DERIVED esbuild bundle (not the raw tarball) at a
// package's cache root as `bundle.js` — an IIFE that leaves a top-level
// `__pkgExports` in scope, which the sandbox prelude registers under
// `require("restormjsdep")` and a same-named global. This hand-written bundle
// reproduces that exact shape so the offline mirror copy is a drop-in cache hit
// with no network + no esbuild pass (the real esbuild path is exercised by the
// opt-in real-registry lane instead).
var __pkgExports = {
  version: "1.0.0",
  greeting: function () {
    return "hello from restormjsdep";
  }
};
