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
    When I click the browser pause button
    Then the session is paused
    When I click the browser pause button
    Then the session is on air
    When I click the browser stop button
    Then the session is idle
    And the session has no "browser" row
    And the recording "browser" tab is closed

  Scenario: Captured calls appear live in the Captures tab and can be filtered
    Given a project with an env folder is open
    When I add a recording session from the env folder's context menu
    And I set the session url to the local test page
    And I click the record button
    Then the session is on air
    When I click the session "captures" row
    Then the captures list shows a call to "/api/ping"
    And the captures list shows a live run row
    When I filter the captures with "nothing-matches"
    Then the captures list shows no call
    When I filter the captures with "ping"
    Then the captures list shows a call to "/api/ping"
    When I click the first captured call
    Then the capture detail shows the response tabs
    When I click the session "browser" row
    And I click the browser stop button
    Then the session is idle

  Scenario: Deducing the routes is a Pro feature — locked on Community
    Given a project with an env folder is open
    When I add a recording session from the env folder's context menu
    And I set the session url to the local test page
    And I click the record button
    Then the session is on air
    When I click the session "captures" row
    Then the captures list shows a call to "/api/ping"
    And the deduce routes button is locked
    When I click the session "routes" row
    Then the recording routes tab shows the Pro callout

  Scenario: On Pro, the captured calls are deduced into real requests under the Routes row
    Given a Pro project with an env folder is open
    When I add a recording session from the env folder's context menu
    And I set the session url to the local test page
    And I click the record button
    Then the session is on air
    When I click the session "captures" row
    Then the captures list shows a call to "/api/ping"
    When I click the session "browser" row
    And I click the browser stop button
    Then the session is idle
    When I click the session "captures" row
    And I click the deduce routes button
    Then the recording "routes" tab is open
    And the recording routes tab lists 1 deduced request
    And the Routes row of the session lists the request "GET /api/ping" in the folder "api"

  Scenario: An agent drives a whole recording over MCP — create, record, read the captures, deduce
    Given a Pro project with an env folder is open with the MCP server enabled
    When I create a recording session over MCP pointing at the local page
    Then the sidebar shows the session created over MCP
    And MCP lists 1 recording session named "MCP recording"
    When I start the recording over MCP
    Then the session is on air
    And the MCP recording status reports at least 2 captures
    When I stop the recording over MCP
    Then the session is idle
    When I deduce the routes over MCP
    Then the MCP deduction reports 1 new route
    And MCP lists the folder "api" under the session and the request "GET /api/ping" inside it
    When I open the session tab over MCP
    And I expand the session row
    Then the Routes row of the session lists the request "GET /api/ping" in the folder "api"

  Scenario: Over MCP, deducing the routes is refused on Community
    Given a project with an env folder is open with the MCP server enabled
    When I create a recording session over MCP pointing at the local page
    Then the sidebar shows the session created over MCP
    And deducing the routes over MCP is refused as a Pro feature
