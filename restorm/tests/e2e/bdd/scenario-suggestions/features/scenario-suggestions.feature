Feature: Scenario inspector data suggestions end-to-end

  Launches restorm on the scenarios reference-tests sample, then — from the
  RUNNING app — extracts every action's pre-run inspector data suggestion for the
  log-actions scenario and guards them against regression with a snapshot. Going
  through the real app (not a pure unit) is what lets the same mechanism later
  cover REST requests, whose suggestions are drawn from the call-history zip.

  Scenario Outline: The <scenario> scenario action suggestions match the snapshot
    Given I open the scenarios reference-tests sample
    When I extract the inspector suggestions for the scenario "<scenario>"
    Then the extracted suggestions match the snapshot

    Examples:
      | scenario       |
      | Logs           |
      | Toast          |
      | Arithmetics    |
      | Loops          |
      | Inputs/outputs |
      | Conditions     |
      | Main           |
