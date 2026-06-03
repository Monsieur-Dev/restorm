Feature: Scenario run-log end-to-end

  Launches restorm on the scenarios reference-tests sample, opens a finished
  scenario, runs it through the real engine, then drives the inspector exactly
  as a user would — flips the "show all logs" toggle so every engine + user
  entry is visible and clicks the copy button — and asserts the copied YAML
  matches a committed golden. This guards the whole run-log pipeline (engine
  events → renderer run-log → YAML copy), not just a pure function.

  These are LEAF scenarios — each runs its own engine graph deterministically.
  The orchestrator scenario (Main) is intentionally NOT run-log tested: it calls
  the leaf scenarios as sub-runs, whose logs interleave non-deterministically in
  the parent log, so a snapshot would be flaky. Main's static suggestions ARE
  covered (see scenario-suggestions), which captures its structure without a run.

  Scenario Outline: The <scenario> scenario run-log matches the snapshot
    Given I open the scenarios reference-tests sample
    When I run the scenario "<scenario>" and copy all its logs
    Then the copied run-log matches the snapshot

    Examples:
      | scenario       |
      | Logs           |
      | Arithmetics    |
      | Loops          |
      | Inputs/outputs |
      | Conditions     |
