Feature: Folder Save Operations
  As a user, I want to save my collections as folders
  so that I can manage them with version control.

  Scenario: Should save as folder with correct structure
    Given the file is loaded
    When I open the File menu
    And I click on "Save As"
    Then the save options modal should be open
    When I select Folder mode
    And I select YAML format
    And I click the Save button
    Then the folder structure should match the reference
