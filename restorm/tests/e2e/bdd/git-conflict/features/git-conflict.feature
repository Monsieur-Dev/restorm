Feature: Git conflict resolution

  Scenario: A rejected push followed by a pull surfaces the conflict-resolution screen
    Given a collaborator has pushed a conflicting change to the request's URL
    And I open my own one-commit-behind clone of that remote
    When I change the request's URL to a different value and push
    Then the push is rejected
    When I close the push dialog
    And I pull
    Then the conflict-resolution screen appears

  Scenario: Conflicts across every element type are listed, individually resolvable, and field-diffs are highlighted
    Given a remote has diverged on a folder, an environment folder, a request, and a scenario
    And I open my own conflicting clone of that remote
    When I pull
    Then the conflict-resolution screen appears
    And all 4 conflicting entities are listed
    And the conflicting folder's notes field is highlighted
    When I keep my own version of the folder
    And I use the server's version of the request and tweak its URL
    And I finish resolving the conflicts
    Then my folder notes were kept, the request URL reflects my tweak, and the untouched entities default to my version

  Scenario: Live-action controls stay disabled while resolving a conflict
    Given a remote has diverged on a mock-server request
    And I open my own conflicting clone of that remote
    When I pull
    Then the conflict-resolution screen appears
    And the mock server's start button in the resolved panel is disabled

  Scenario: Cancelling conflict resolution aborts the merge and keeps local work intact
    Given a remote has diverged on the request
    And I open my own conflicting clone of that remote
    When I pull
    Then the conflict-resolution screen appears
    When I cancel conflict resolution
    Then the merge is aborted and my local commit is intact

  Scenario: Opening a project whose remote has moved shows a pull-available toast
    Given a collaborator has pushed a non-conflicting change to the remote
    When I open my own one-commit-behind clone of that remote
    Then a pull-available toast appears
    When I click pull now in the toast
    Then the pull lands the collaborator's change on disk

  Scenario: The generated commit message covers every changed entity kind
    Given I open a project with unsaved local edits to a folder and a request
    When I open the push dialog
    Then the generated commit title lists both changed entity kinds
