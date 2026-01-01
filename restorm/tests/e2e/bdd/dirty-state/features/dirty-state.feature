Feature: Dirty State Indicators
  As a user, I want to see a dirty indicator when I modify content
  so that I know I have unsaved changes.

  Scenario: Should show dirty indicator on tab, titlebar when content is modified
    Given the file is loaded
    And the title does not contain "*"
    When I click on "Swagger Petstore" folder
    Then a tab should be open
    And the tab should not have a dirty indicator
    When I click on the Notes inner tab
    And I type "Test modification for dirty state" in the editor
    Then the tab should have a dirty indicator
    And the title should contain "*"
    When I undo multiple times
    Then the tab should not have a dirty indicator
    And the title should not contain "*"

  Scenario: Should show dirty indicator when modifying in folder mode
    Given the file is loaded
    When I click on "Swagger Petstore" folder
    Then a tab should be open
    And the tab should not have a dirty indicator
    When I modify an input field
    Then the tab should have a dirty indicator
    And the title should contain "*"

