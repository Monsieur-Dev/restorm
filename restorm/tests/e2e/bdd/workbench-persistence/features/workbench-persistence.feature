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

  Scenario: The selected environment for a request is remembered across reopens, even when the request is renamed
    Given the file is loaded
    When I close every tab in the workbench via middle-click
    And I expand "Swagger Petstore" in the sidebar
    And I expand "pet" in the sidebar
    And I open "Find pet by ID" from the sidebar
    And I select the "Production" environment in the workbench
    Then the selected environment in the workbench should be "Production"
    When I rename "Find pet by ID" to "Find pet" in the sidebar
    And I middle-click the tab "Find pet"
    And I open "Find pet" from the sidebar
    Then the selected environment in the workbench should be "Production"
