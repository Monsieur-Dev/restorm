Feature: Breadcrumb Icon Change and Folder Management
  As a user, I want to change folder icons and create/rename/delete folders
  so that I can customize and organize my workspace.

  Scenario: Changing a folder icon updates breadcrumb, sidebar, tab, and dirty state
    Given the file is loaded
    And the title does not contain "*"
    When I click on "Swagger Petstore" folder in the sidebar
    Then a tab should be open for the folder
    And the tab should not have a dirty indicator
    When I open the breadcrumb icon select
    And I select the codicon tab in the icon picker
    And I search for "heart" in the icon picker
    And I select the first codicon result
    Then the breadcrumb icon should be "heart"
    And the sidebar item "Swagger Petstore" icon should be "heart"
    And the tab should have a dirty indicator
    And the title should contain "*"
    And the active tab should contain icon "heart"

  Scenario: Renaming a folder via sidebar updates breadcrumb
    Given the file is loaded
    When I click on "pet" folder in the sidebar
    Then a tab should be open for the folder
    When I rename "pet" to "pet-renamed" in the sidebar
    Then the breadcrumb should show "pet-renamed"
    And the sidebar item "pet-renamed" should be visible
