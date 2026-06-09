Feature: Postman workflow import → scenario execution

  A Postman collection whose requests carry pre-request / test scripts imports
  as an executable restorm scenario, and the verbatim `pm.*` scripts run against
  the live API when the scenario is executed.

  Scenario: Importing a script-bearing Postman collection builds a runnable workflow scenario
    Given a new single-file collection for Postman import
    When I import the Postman workflow collection
    Then a workflow scenario "Petstore Workflows (restorm compat) — Workflow" appears in the tree
    When I run the imported workflow scenario and copy all its logs
    Then the run-log shows the verbatim Postman scripts executing across the chain
    And the run-log shows a request succeeded against the live API with a passing pm.test
