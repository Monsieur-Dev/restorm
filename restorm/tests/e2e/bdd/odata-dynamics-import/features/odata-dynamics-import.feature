Feature: OData Dynamics import — performance baseline and validation
  Drives the full import flow against the real Aldes CRM Dynamics
  OData endpoint: create a file, paste the $metadata URL, configure
  the OAuth token route, prefetch it, run the import, and measure
  the latency end-to-end. Credentials live in a gitignored fixture
  (`tests/e2e/fixtures/dynamics-creds.json`), so the scenario skips
  silently when the file isn't present.

  Scenario: Import 10k+ requests with OAuth auth route and measure timings
    Given a new single-file YAML collection for the dynamics import
    When I open the import modal and paste the dynamics metadata URL
    And I configure the dynamics OAuth token route and save it
    And I click Import and wait for the sidebar to be populated
    Then the collection contains the dynamics authentication route
    And a non-auth request shows the dynamics auth selected in the status bar
    And import timings are reported
