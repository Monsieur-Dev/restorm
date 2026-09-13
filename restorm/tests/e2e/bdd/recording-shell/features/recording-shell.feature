Feature: Recording session sidebar nodes and tabs
  A recording session is a tree item created from the sidebar "Add" menu
  (right under "API design") and from the Create menu. Its row carries the
  on-air badge and expands into VIRTUAL rows: Captures (always) and Routes
  (always last) — the browser row only exists while a recording runs. Each
  row opens its OWN workbench tab. The session persists at file format 1.2.

  Scenario: Create a session from an env folder's Add menu
    Given a project with an env folder is open
    When I add a recording session from the env folder's context menu
    Then the sidebar carries a recording session named "New recording session"
    And the session row is expanded with a "captures" row and a "routes" row
    And the session has no "browser" row
    And the recording "config" tab is open

  Scenario: Every node row opens its own tab
    Given a project with an env folder is open
    When I add a recording session from the env folder's context menu
    And I click the session "captures" row
    Then the recording "captures" tab is open
    When I click the session "routes" row
    Then the recording "routes" tab is open
    When I click the session row
    Then the recording "config" tab is open

  Scenario: A scenario's Add menu offers no recording session
    Given a project with an env folder is open
    When I add a scenario from the env folder's context menu
    And I open the Add submenu of the new scenario row
    Then the Add submenu offers no recording session entry

  Scenario: The session persists at file format 1.2 and reopens
    Given a project with an env folder is open
    When I add a recording session from the env folder's context menu
    And I save the project
    Then the saved file carries a recording session named "New recording session"
    And the saved file declares file format version "1.2"

  Scenario: The record button needs a page url, then starts and stops a recording
    Given a project with an env folder is open
    When I add a recording session from the env folder's context menu
    Then the record button is disabled
    When I set the session url to the local test page
    Then the record button is enabled
    When I click the record button
    Then the session has a "browser" row
    And the recording "browser" tab is open
    And the session is on air
    When I click the session row
    And I click the record button
    Then the session is idle
    And the session has no "browser" row
