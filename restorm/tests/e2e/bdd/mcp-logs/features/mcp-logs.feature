Feature: MCP call-logs viewer follows the workbench
  As a user, I want to inspect the MCP calls Restorm has served — opened
  as a full-screen modal on the welcome screen, or as a workbench tab once
  a file is open, the same way Settings behaves.

  Background:
    Given system modals mocking is installed

  Scenario: The View menu opens the modal on the welcome screen
    Given no file is open
    When I open MCP logs from the View menu
    Then the MCP logs modal should be visible
    And no MCP logs tab should be open

  Scenario: The View menu opens a tab once a file is open
    Given a project folder is open
    When I open MCP logs from the View menu
    Then an MCP logs tab should be open
    And the MCP logs modal should not be visible
    And the MCP logs tab should not appear in the opened-items list

  Scenario: The MCP logs tab is a singleton
    Given a project folder is open
    When I open MCP logs from the View menu
    And I open MCP logs from the View menu
    Then exactly one MCP logs tab should be open

  Scenario: The MCP logs tab survives a reload
    Given a project folder is open
    When I open MCP logs from the View menu
    Then an MCP logs tab should be open
    When I reload the window
    Then exactly one MCP logs tab should be open
    And the MCP logs modal should not be visible
