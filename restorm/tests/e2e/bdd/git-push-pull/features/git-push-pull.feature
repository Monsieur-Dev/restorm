Feature: Git push and pull
  The atomic commit+push flow (status-bar button → Push modal → Push) and a
  clean pull (no conflicts). Opt out with SKIP_GIT_E2E=1 on a host that
  cannot run the git-server docker mock.

  Scenario: Pushing a local change lands on the remote
    Given I open a project cloned from a freshly seeded git remote
    When I change the request's URL and push
    Then the remote has the pushed change

  Scenario: Pulling with no conflicts fetches the latest remote change
    Given another collaborator has pushed a change to a freshly seeded git remote
    And I open my own clone of that same remote
    When I pull
    Then the collaborator's change is visible

  # Reordered on purpose: the clone is opened BEFORE the collaborator's push,
  # so restorm's in-memory tree is stale at pull time and the pull must
  # actively refresh the open project — the path the scenario above (which
  # opens the clone AFTER the change already landed) can't exercise.
  Scenario: A clean pull refreshes the open project without a manual reload
    Given I have opened a clone of a freshly seeded git remote
    When a collaborator pushes a change to that same remote
    And I pull
    Then the collaborator's change is visible without reopening the project

  # The open-tab path: the tree/sidebar refresh above read the live tree, but an
  # already-open request tab caches its editable fields (URL, params, ...) in
  # local state seeded once at open. So a clean pull must also remount the open
  # tab, otherwise it keeps showing the pre-pull value until close/reopen.
  Scenario: A clean pull refreshes an already-open request tab without reopening it
    Given I have opened a clone of a freshly seeded git remote
    And I have the request open in a tab showing its original URL
    When a collaborator pushes a URL change to that same remote
    And I pull
    Then the open request tab shows the pulled URL without reopening it

  # The unsaved-edits path: pull saves first, so the edit reaches disk, but git
  # refuses to merge remote changes on top of unpushed local changes — the edit
  # is kept, the remote change is NOT silently applied, and the user is told to
  # push first.
  Scenario: Pulling with unsaved local edits keeps the edits and asks to push first
    Given I have opened a clone of a freshly seeded git remote
    And I have an unsaved local edit to the open request
    When a collaborator pushes a change to that same remote
    And I pull
    Then my unsaved edit is preserved on disk
    And I am told to push my changes before pulling
    And the collaborator's change is not applied
