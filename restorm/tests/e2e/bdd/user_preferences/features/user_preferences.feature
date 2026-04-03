Feature: User preferences

  Scenario: user_preferences
    Given system modals mocking is installed
    And the welcome screen should be visible
    And recent files and favorites should be empty

    Given I configure the open file dialog to return the sample file path
    When I trigger menu shortcut "Ctrl+O"
    Then an open dialog should have been shown
    And the file should be loaded
    And the sidebar should contain items

    When I click on the first sidebar item
    Then the workbench should contain an open tab

    When I reset system modals mock history
    When I open menu bar "titlebar-menubar" menu "titlebar-menubar-item-file"
    And I click menu bar item "titlebar-menu-item-close"
    Then no confirmation dialog should have been shown
    And the welcome screen should be visible
    And the recent files list should contain the sample file
    And the favorites list should be empty

    When I favorite the recent file
    Then the favorites list should contain the sample file

    When I remove the file from favorites
    Then the favorites list should be empty

    When I open the recent file
    Then the file should be loaded
    And the workbench should contain an open tab

