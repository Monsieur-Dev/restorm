Feature: Sidebar → workbench drag opens a split view

  Dragging a sidebar item over an open workbench tab shows the same split
  overlay as dragging a tab onto another tab: releasing on an edge opens the
  dragged item beside the target, releasing in the centre stacks it as a tab.
  A drop on a SCENARIO tab still adds the item to the graph and never splits.

  Background:
    Given the sidebar-split-drop reference project is open
    And I expand the path "Auth Service" then "Pet API"

  Scenario: Dropping a sidebar request on a tab's right edge splits the view
    Given I open the request "Health" as a workbench tab
    And the workbench has 1 editor group
    When I drag the sidebar request "Get Pet by Id" onto the open tab "right" edge
    Then the workbench has 2 editor groups
    And a workbench tab for "Get Pet by Id" is open

  Scenario: Dropping a sidebar request on a tab's centre stacks it as a tab
    Given I open the request "Health" as a workbench tab
    And the workbench has 1 editor group
    When I drag the sidebar request "Get Pet by Id" onto the open tab "center" zone
    Then the workbench has 1 editor group
    And a workbench tab for "Get Pet by Id" is open

  Scenario: Dropping a sidebar request on a scenario tab still adds it to the graph
    Given I expand the path "Pet API" then "Main"
    And I open the scenario "Logs" as a workbench tab
    And the workbench has 1 editor group
    And I count the scenario graph nodes
    When I drag the sidebar request "Health" onto the open scenario surface
    Then the workbench still has 1 editor group
    And the scenario graph gained a node
