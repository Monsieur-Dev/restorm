Feature: Workbench (EditorWorkbench)

  Scenario: Initial groups and tabs are rendered
    Given I open the workbench e2e tab
    Then editor workbench "workbench-basic" should be visible
    And workbench "workbench-basic" should have 2 groups
    And workbench "workbench-basic" group "group-left" should have 2 tabs
    And workbench "workbench-basic" group "group-right" should have 2 tabs
    And active tab in workbench "workbench-basic" group "group-left" should be "tab-a"
    And active tab in workbench "workbench-basic" group "group-right" should be "tab-c"

  Scenario: Activating a tab updates active tab state
    Given I open the workbench e2e tab
    When I activate workbench "workbench-basic" group "group-left" tab "tab-b"
    Then active tab in workbench "workbench-basic" group "group-left" should be "tab-b"
    And editor workbench last event should contain "activate:group-left:tab-b"

  Scenario: Context menu can close other tabs in group
    Given I open the workbench e2e tab
    When I open workbench "workbench-basic" group "group-left" tab "tab-b" context menu
    Then context menu "workbench-basic-group-group-left-tabs-contextmenu" should be visible
    When I click context menu "workbench-basic-group-group-left-tabs-contextmenu" item "Close other tabs"
    Then workbench "workbench-basic" group "group-left" should have 1 tabs
    And editor workbench last event should contain "contextmenu:group-left:closeOthers"

  Scenario: Reordering tabs within a group changes order in the tree
    Given I open the workbench e2e tab
    When I reorder workbench "workbench-basic" group "group-left" tab "tab-b" to index 0
    Then workbench tree for group "group-left" should have tab "tab-b" before "tab-a"

  Scenario: Moving a tab into another group (drop center) changes group tab counts
    Given I open the workbench e2e tab
    When I move workbench "workbench-basic" tab "tab-a" from group "group-left" to group "group-right" at index 0
    Then workbench "workbench-basic" group "group-left" should have 1 tabs
    And workbench "workbench-basic" group "group-right" should have 3 tabs

  Scenario: Sash resize triggers sizes change callback
    Given I open the workbench e2e tab
    When I drag sash "workbench-basic-sash-root-0" by x 40 y 0
    Then editor workbench last event should contain "sizes:root:"

  Scenario: Persistence restores after reload
    Given I open the workbench e2e tab
    When I close workbench "workbench-basic" group "group-right" tab "tab-d"
    Then workbench "workbench-basic" group "group-right" should have 1 tabs
    When I reload the page and reopen the workbench e2e tab
    Then workbench "workbench-basic" group "group-right" should have 1 tabs

  Scenario: Multi-window send drops tab into aux window
    Given I open the workbench e2e tab
    When I open the workbench aux window
    And I set workbench ipc mode to "send"
    When I reorder workbench "workbench-basic" group "group-left" tab "tab-a" to index 0
    Then aux window should show dropped tab id "tab-a"

