Feature: OData mock server end-to-end (self-hosted)
  restorm hosts a local OData v4 service AND calls it as a client — no external
  service. Boots restorm with `--mcp`, opens the sample, starts the Pets Mock
  (assert the Listen toggle flips to the listening state + the served banner
  shows), then runs the Pets Consumer against it and asserts it receives the
  served collection, and finally stops the mock.

  Scenario: Host an OData mock, consume it in-instance, then stop
    Given I launch restorm with the MCP server enabled
    And I open the OData mock sample via MCP
    Then the "Pets Mock" request shows the SRV badge in the tree

    When I open the "Pets Mock" request tab via MCP
    When I click the Listen button
    Then the Listen button shows the listening state
    And the mock shows the listening banner

    When I open the "Pets Consumer" request tab via MCP
    And I click the Send button
    Then the response body contains "Whiskers"

    When I open the "Pets Mock" request tab via MCP
    Then the mock shows at least 1 request served

    When I click the Stop button
    Then the Listen button shows the stopped state
