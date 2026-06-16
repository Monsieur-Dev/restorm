Feature: Settings surface follows the workbench
  As a user, I want Settings to open as a full-screen modal on the
  welcome screen, but as a workbench tab once a file is open, so the
  Settings content lives alongside my other tabs when I am working.

  Background:
    Given system modals mocking is installed

  Scenario: The gear button opens the modal on the welcome screen
    Given no file is open
    When I open Settings from the gear button
    Then the Settings modal should be visible
    And no Settings tab should be open

  Scenario: View menu opens the modal on the welcome screen
    Given no file is open
    When I open Settings from the View menu
    Then the Settings modal should be visible
    And no Settings tab should be open

  Scenario: The gear button opens a tab once a file is open
    Given a project folder is open
    When I open Settings from the gear button
    Then a Settings tab should be open
    And the Settings modal should not be visible
    And the Settings tab should not appear in the opened-items list

  Scenario: View menu opens a tab once a file is open
    Given a project folder is open
    When I open Settings from the View menu
    Then a Settings tab should be open
    And the Settings modal should not be visible
    And the Settings tab should not appear in the opened-items list

  Scenario: The Settings tab is a singleton
    Given a project folder is open
    When I open Settings from the gear button
    And I open Settings from the gear button
    Then exactly one Settings tab should be open

  Scenario: The Settings tab survives a reload
    Given a project folder is open
    When I open Settings from the gear button
    Then a Settings tab should be open
    When I reload the window
    Then exactly one Settings tab should be open
    And the Settings modal should not be visible
