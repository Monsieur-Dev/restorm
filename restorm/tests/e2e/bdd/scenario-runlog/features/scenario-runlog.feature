Feature: Scenario run-log end-to-end

  Launches restorm on the scenarios reference-tests sample, opens a finished
  scenario, runs it through the real engine, then drives the inspector exactly
  as a user would — flips the "show all logs" toggle so every engine + user
  entry is visible and clicks the copy button — and asserts the copied YAML
  matches a committed golden. This guards the whole run-log pipeline (engine
  events → renderer run-log → YAML copy), not just a pure function.

  These are LEAF scenarios. The orchestrator (Main) is NOT run-log tested: even
  though its sub-scenario CALLS are serialized (chained `done`→`in`) and each
  runScenario now fires its continuation exactly once (see the runScenarioExecutor
  fix that dropped the redundant `done` emission), the NODES inside a sub-scenario
  still run concurrently in the data-driven engine — e.g. Inputs/outputs' three
  independent `output` nodes — so their entries interleave non-deterministically
  in Main's merged log. Main's static suggestions ARE covered (scenario-suggestions).

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
