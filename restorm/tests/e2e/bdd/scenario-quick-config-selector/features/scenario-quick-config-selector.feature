Feature: Scenario request-action config selector stays live with the request popover
  A request action node in a scenario shows a "Base configuration" dropdown
  button sourced from the bound request's saved quick-configs (TASK-66.25).
  Only FILE (project-target) configs appear; user-mode configs never do. The
  whole point is LIVE sync with no manual workbench refresh: adding, overwriting
  or deleting a config on the request must reflect immediately in BOTH the
  request's quick-settings popover list AND the scenario node's selector. This
  scenario walks the exact côte-à-côte sequence Yoann specified, asserting both
  surfaces at every step so a sync regression can never hide behind a refresh.

  Background:
    Given I launch restorm and open the quick-config-selector sample
    And the "qcs-req" request and the "qcs-scn" scenario are both open as tabs

  Scenario: The 7-step user/file/overwrite/delete sequence keeps both surfaces in sync
    # Step 1 — user-mode config: popover lists it, scenario selector stays hidden.
    When I save a quick config named "test" in "settings" mode on the request
    Then the request popover lists a config named "test" with the "settings" badge
    And the scenario action shows no config selector

    # Step 2 — file-mode config of the same name overwrites to file: selector appears.
    When I save a quick config named "test" in "project" mode on the request
    Then the request popover lists a config named "test" with the "project" badge
    And the scenario action shows a config selector with items "none, test"

    # Step 3 — add a second file config: both surfaces gain it.
    When I save a quick config named "test2" in "project" mode on the request
    Then the request popover lists a config named "test2" with the "project" badge
    And the scenario action shows a config selector with items "none, test, test2"

    # Step 4 — pick "test" on the scenario action.
    When I select the config "test" in the scenario action
    Then the scenario action selector shows "test" as selected

    # Step 5 — delete "test" on the request: scenario deselects it and drops it.
    When I delete the quick config named "test" on the request
    Then the request popover does not list a config named "test"
    And the request popover lists a config named "test2" with the "project" badge
    And the scenario action shows a config selector with items "none, test2"
    And the scenario action selector does not show "test" as selected

    # Step 6 — pick "test2" on the scenario action.
    When I select the config "test2" in the scenario action
    Then the scenario action selector shows "test2" as selected

    # Step 7 — overwrite "test2" to user mode: no file config remains, selector disappears.
    When I save a quick config named "test2" in "settings" mode on the request
    Then the request popover lists a config named "test2" with the "settings" badge
    And the scenario action shows no config selector

  # The selector row carries no port, so its appearance shifts every row below
  # it (the env field) WITHOUT changing the box's port signature — and it
  # appears while the scenario tab is hidden (the save happens on the request
  # tab). Both were exactly the conditions under which handle positions went
  # stale: the hidden-tab measurement published zeros, and a port-less row
  # never re-triggered it. The handles must sit on their rows' centres after
  # each flip.
  Scenario: Node port handles stay on their row centres as the selector row appears and disappears
    When I save a quick config named "porttest" in "project" mode on the request
    Then the scenario action shows a config selector with items "none, porttest"
    And every port handle of the request action node sits on its row centre
    When I delete the quick config named "porttest" on the request
    Then the scenario action shows no config selector
    And every port handle of the request action node sits on its row centre
