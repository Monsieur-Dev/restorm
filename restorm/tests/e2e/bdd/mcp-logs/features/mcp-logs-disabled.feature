Feature: MCP logs menu entry is gated on the MCP server
  As a user, I should not be offered the MCP logs viewer when the embedded
  MCP server isn't running — there'd be nothing to view.

  Scenario: The View menu entry is disabled with no MCP server
    Given no file is open
    Then the MCP logs menu entry should be disabled
