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

  # The inverse guarantee: a run's variables must vanish WITH the run. The
  # "Leak probe" request declares its OWN literal petId row (2); the "Leak
  # check" scenario sets petId=1 upstream of it. During the run, the run's
  # value wins (the run log proves /pet/1). After the run, both the DISPLAYED
  # resolved URL and a real manual Send must be back on the request's own row
  # — a run context that outlives its run used to keep feeding /pet/1 here,
  # visible only on a VISIBLE tab and, worse, on the wire.
  Scenario: a finished run leaves the request's own petId on the display and on the wire
    Given I open the setVariable-override sample
    When I run the "Leak check" scenario and copy all its logs
    Then the copied run-log shows the run went to "/pet/1"
    When I open the "Leak probe" request from the sidebar
    Then the visible resolved URL ends with "/pet/2"
    When I send the visible request
    Then the visible response body shows "Cat 2"

  # The ex-"unchecking does nothing" report: toggling a row always invalidated
  # correctly — what made it LOOK broken was a leaked run value still feeding
  # the variable, so the fallback to the env value never showed. With the
  # disposable run context, unchecking the row right after a run must fall
  # back to the env folder's petId (3) immediately, no close/reopen.
  Scenario: unchecking the row right after a run falls back to the env value
    Given I open the setVariable-override sample
    When I run the "Leak check" scenario and copy all its logs
    And I open the "Leak probe" request from the sidebar
    And I uncheck the "petId" path param row
    Then the visible resolved URL ends with "/pet/3"
