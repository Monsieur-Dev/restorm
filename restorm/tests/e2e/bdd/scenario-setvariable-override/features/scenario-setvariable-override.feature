Feature: Scenario setVariable overrides an env-folder variable for a downstream request

  An environment folder declares `petId` and a request ("Find pet by ID") uses
  it in its URL `{{baseUrl}}/pet/{{petId}}`. In a scenario, a `setVariable petId`
  placed BEFORE the request action must win: the request runs with the
  setVariable value, NOT the env-folder value. Verified against the live petstore
  mock — the run resolves to /pet/<setVariable> and returns that pet.

  Scenario: a setVariable before the request overrides the env-folder petId
    Given I open the setVariable-override sample
    When I run the "setVariable override" scenario and copy all its logs
    Then the setVariable run-log matches the snapshot

  # The scenario above lives inside a folder. A scenario may also sit at the
  # ROOT, as a sibling of a collection — the sidebar's empty-area "Ajouter ▸
  # Scénario" creates one there, so it is a first-class placement.
  #
  # This covers the INTERACTIVE path specifically, and that is the point: the
  # renderer mirrors its whole tree to the main process, and the main process
  # reifies what arrives. Both used to drop a root-placed scenario — the mirror
  # kept only the env-folders, and the reify coerced whatever survived into one
  # — so the engine was asked to run something it had never been told about.
  # A programmatic (MCP) creation enters further down and does NOT traverse the
  # mirror, so only a UI-driven run like this one can catch that half coming
  # back. Every other scenario in the corpus is nested, which is why it shipped.
  Scenario: a scenario created at the root of the sidebar launches
    Given I open the setVariable-override sample
    When I create a scenario named "Root launch check" at the root of the sidebar
    And I run the root scenario "Root launch check" from its editor
    Then the root scenario "Root launch check" ran without a missing-scenario error
