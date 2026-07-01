Feature: Code node — external dependencies (offline, chained golden)

  An EXTENSIBLE multi-language dependency chain, run through the real engine. Each
  supported language contributes ONE `code` node that installs + imports a pinned
  package — provisioned from the committed offline wheel mirror
  (RESTORM_CODE_DEPS_OFFLINE_DIR, zero live registry, CI-deterministic) — and
  accumulates its marker into a pass-through dict; the chain ends in a Log node,
  and the whole run-log is compared to a committed golden.

  This tranche seeds the chain with the Python link (installs `restormpydep`, a
  tiny zero-dependency pure-Python wheel). Later language tranches append their
  own code node + package before the Log node and REGENERATE the one golden
  (UPDATE_RUNLOG_GOLDEN=1) — one growing chain, one golden.

  Scenario: The code-deps-chain run-log matches the golden
    Given I open the reference sample with the offline package mirror
    When I run the "code-deps-chain" scenario
    Then the code-deps-chain run-log matches the golden

  Scenario: Re-running the chain reuses the dependency cache with no second download
    Given I open the reference sample with the offline package mirror
    When I run the "code-deps-chain" scenario
    And I run the "code-deps-chain" scenario a second time
    Then the second run reports no package download
