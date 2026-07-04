Feature: Code node — external dependencies (real registries, opt-in)

  The real-registry counterpart of the offline code-deps chain. It runs the SAME
  five-language shape but pins REAL packages and installs them from the LIVE
  registries — PyPI (six), npm (is-number), the WebR CRAN repository (praise),
  RubyGems (paint), LuaRocks (inspect) — validating the true first-run download +
  cache path end to end, not just the offline mirror copy.

  This needs network and is non-deterministic (registry latency, live artifacts),
  so the project is OPT-IN: `playwright.config.ts` includes it only when
  `RESTORM_E2E_REAL_DEPS=1`, so the default suite, the pre-push hook, and CI never
  see it. Run it deliberately as a nightly / release guard:

    RESTORM_E2E_REAL_DEPS=1 xvfb-run -a pnpm exec playwright test --project code-deps-real-registry

  Assertions are structural (each language's import-success marker + the
  download/cache signals), never a byte-equal golden — live versions and network
  noise make a golden meaningless here.

  Scenario: Every language installs its pinned package from its live registry
    Given I open the reference sample for a live dependency install
    When I run the "code-deps-chain-real" scenario against live registries
    Then every language reports its package loaded
    And the first run reports a package download

  Scenario: Re-running reuses the dependency cache with no second download
    Given I open the reference sample for a live dependency install
    When I run the "code-deps-chain-real" scenario against live registries
    And I run the "code-deps-chain-real" scenario against live registries a second time
    Then the second run reports no package download
