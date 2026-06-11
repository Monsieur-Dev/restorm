Feature: Secret-source scenarios produce a stable run-log
  Each secret value source gets its own scenario in the secrets-sources
  demo fixture, named after the source type (e.g. EnvVar). The scenario
  resolves the secret, dispatches a request that echoes it back, and an
  assert node validates the resolved plaintext. Capturing the run-log as a
  committed golden guards the whole secret-resolution + execution pipeline
  against regression — exactly like the scenario-runlog suite, but scoped
  to the secrets fixture (whose launcher injects RESTORM_E2E_SECRET so the
  envVar source resolves).

  Scenario Outline: <scenario> run-log matches the snapshot
    Given I open the secrets-sources demo collection for run-log capture
    When I run the secret scenario "<scenario>" and copy all its logs
    Then the secret-scenario run-log matches the snapshot

    Examples:
      | scenario |
      | EnvVar   |
