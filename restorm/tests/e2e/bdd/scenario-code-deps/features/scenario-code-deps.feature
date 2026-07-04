Feature: Code node — external dependencies (offline, chained golden)

  An EXTENSIBLE multi-language dependency chain, run through the real engine. Each
  dep-supporting language contributes ONE `code` node that installs + imports a
  pinned package — provisioned from the committed offline package mirror
  (RESTORM_CODE_DEPS_OFFLINE_DIR, zero live registry, CI-deterministic) — and
  accumulates its `{lang: version}` marker into a pass-through dict; the chain
  ends in a Log node, and the whole run-log is compared to a committed golden.

  The chain covers all five dep-supporting languages, in order: Python
  (`restormpydep`, a pure-Python wheel), JavaScript (`restormjsdep`, a pure-JS
  esbuild bundle), R (`praise`, a pure-R WebR binary), Ruby (`restormrbdep`, a
  pure-Ruby gem), Lua (`restormluadep`, a pure-Lua module). Four of the five are
  tiny hand-authored fixtures; R alone is a real CRAN package binary (WebR loads
  R-compiled WASM, which cannot be hand-authored) pinned to the bundled WebR's R
  version — see the mirror's `r/README.md` for the re-fetch procedure on a WebR
  upgrade.

  Extending the chain (adding a language link or changing a node) REGENERATES the
  one golden: run with UPDATE_RUNLOG_GOLDEN=1 — one growing chain, one golden.

  Scenario: The code-deps-chain run-log matches the golden
    Given I open the reference sample with the offline package mirror
    When I run the "code-deps-chain" scenario
    Then the code-deps-chain run-log matches the golden

  Scenario: Re-running the chain reuses the dependency cache with no second download
    Given I open the reference sample with the offline package mirror
    When I run the "code-deps-chain" scenario
    And I run the "code-deps-chain" scenario a second time
    Then the second run reports no package download
