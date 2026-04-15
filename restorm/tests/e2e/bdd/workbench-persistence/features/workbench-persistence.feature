Feature: Workbench tab persistence across file close/reopen
  As a user, when I close every tab of a file and then close and reopen that
  file, I want the workbench to come back empty — not with the last tab I
  closed resurrected from the previous session's state.

  Scenario: Closing every tab via middle-click before closing the file leaves the workbench empty on reopen
    Given the file is loaded
    When I close every tab in the workbench via middle-click
    And I expand "Swagger Petstore" in the sidebar
    And I expand "pet" in the sidebar
    And I open "Find pet by ID" from the sidebar
    And I open "Add a new pet to the store" from the sidebar
    And I close every tab in the workbench via middle-click
    Then the workbench should have no tabs
    When I close the current file
    And I reopen the Petstore file from the welcome screen
    Then the workbench should have no tabs
