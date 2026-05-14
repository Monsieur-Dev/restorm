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
    And the MCP tool list should include "set_tab_maximized"

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

    # `set_tab_maximized` drives `EditorWorkbench`'s fullscreen handle:
    # maximizing opens the request tab in the shared fullscreen modal,
    # restoring closes it back to its split-pane slot. The maximized and
    # normal views are the SAME React instance — the tab's host node is
    # relocated, never remounted — so state must survive the round-trip
    # both ways:
    #  - normal → maximized: the run_request response itself. The status
    #    row is the load-bearing assertion here — a remount would default
    #    the sub-tab back to "infos" too, so only "the response is still
    #    THERE" actually rules a remount out.
    #  - maximized → normal: a response sub-tab switch performed while the
    #    tab is maximized must still be the active selection after restore.
    When I open the first imported request as a workbench tab via MCP
    And I maximize the current workbench tab via MCP
    Then the fullscreen workbench modal should be visible
    And the active response sub-tab should be "infos"
    And the response Infos panel should show status "200"
    When I select the "response" response sub-tab
    And I restore the maximized workbench tab via MCP
    Then the fullscreen workbench modal should be hidden
    And the active response sub-tab should be "response"

    # ── MCP tool surface added on this branch ──
    # Each tool below crosses the MCP → main → renderer boundary; assert
    # both the JSON-RPC reply and, where the tool has one, the renderer
    # effect. The firewall rule list is asserted via MCP only (the panel
    # CRUD UI is already covered by full-workflow).
    When I call MCP open_console
    Then the Console panel should be visible
    When I call MCP open_firewall
    Then the Firewall panel should be visible

    When I allow the origin "https://e2e-allowed.example" via MCP
    And I deny the origin "https://e2e-blocked.example" via MCP
    Then MCP firewall_list_rules should whitelist "e2e-allowed.example"
    And MCP firewall_list_rules should blacklist "e2e-blocked.example"

    When I call MCP open_mini_browser
    Then the Mini browser tab should be open

    When I set the MCP env variable "mcpProbe" to "probe-value" on the imported env folder
    Then MCP list_env_variables should report "mcpProbe" is "probe-value"
    When I delete the MCP env variable "mcpProbe"
    Then MCP list_env_variables should not report "mcpProbe"

    When I run an MCP batch of open_console then get_current_tab
    Then the MCP batch reply should report 2 of 2 steps ran
