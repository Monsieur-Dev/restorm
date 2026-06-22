Feature: gRPC mock server end-to-end (self-hosted)
  restorm hosts a local gRPC mock server AND calls it as a client — no external
  service. Boots restorm with `--mcp`, opens the sample, starts the Greeter Mock
  (assert the Start toggle flips to the listening state + the served banner
  shows), then runs the Greeter Consumer against it and asserts it receives the
  configured canned message, runs the Error Consumer and asserts the configured
  non-OK status, and finally stops the mock.

  Scenario: Host a gRPC mock, consume it in-instance, then stop
    Given I launch restorm with the MCP server enabled
    And I open the gRPC mock sample via MCP
    Then the "Greeter Mock" request shows the SRV badge in the tree

    When I open the gRPC server "Greeter Mock" request tab via MCP
    And I click the gRPC Start button
    Then the gRPC Start button shows the listening state
    And the gRPC mock shows the listening banner

    When I open the "Greeter Consumer" request tab via MCP
    And I click the gRPC Invoke button
    Then the gRPC response shows a message matching "hello from the restorm mock"

    When I open the "Greeter Error Consumer" request tab via MCP
    And I click the gRPC Invoke button
    Then the gRPC response shows a non-OK status code 5

    When I open the gRPC server "Greeter Mock" request tab via MCP
    Then the gRPC mock shows at least 2 calls served

    When I click the gRPC Stop button
    Then the gRPC Start button shows the stopped state
