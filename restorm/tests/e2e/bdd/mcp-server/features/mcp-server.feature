Feature: MCP server end-to-end
  Boots restorm with `--mcp`, then drives the embedded JSON-RPC server
  the same way an MCP client (Claude / Cursor) would: discover the port
  + token from the launcher discovery file, list tools, create a
  project, import a Petstore swagger, and execute a request — asserting
  on both the JSON-RPC reply payload and the renderer UI updates.

  Scenario: List tools, create a project, import petstore, run a request
    Given I launch restorm with the MCP server enabled

    When I send the MCP tools-list request
    Then the MCP tool list should include "run_request"
    And the MCP tool list should include "cancel_request"
    And the MCP tool list should include "run_request_batch"
    And the MCP tool list should include "batch"
    And the MCP tool list should include "read_stream"
    And the MCP tool list should include "get_response_history"
    And the MCP tool list should include "get_response"

    When I call MCP create_project with name "mcp-e2e"
    Then the workbench should not show the welcome screen

    When I call MCP import_from_url with the local petstore swagger
    Then the MCP reply should report at least 1 imported items
    And the sidebar should show the "Petstore" folder

    When I call MCP list_requests for the imported folder
    And I run the first imported request via MCP
    Then the MCP run_request reply should report status 200
    And the response panel should show a non-empty body
    And the response history panel should show at least 1 entry
