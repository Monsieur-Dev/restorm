Feature: Sidebar folder expansion persists when navigating via tabs
  As a user, when I click on a tab to navigate, the sidebar should expand
  the parent folders and keep them expanded even when I toggle other folders.

  Scenario: Expanding a folder via tab click should persist when toggling another folder
    Given the file is loaded
    When I expand "Swagger Petstore" in the sidebar
    And I expand "pet" in the sidebar
    And I open "Find pet by ID" from the sidebar
    And I open "Updates a pet in the store with form data" from the sidebar
    And I collapse "Swagger Petstore" in the sidebar
    Then "Swagger Petstore" should be collapsed in the sidebar
    When I click the tab "Find pet by ID" in the workbench
    Then "Swagger Petstore" should be expanded in the sidebar
    When I expand "GraphQL Docker" in the sidebar
    Then "Swagger Petstore" should be expanded in the sidebar
