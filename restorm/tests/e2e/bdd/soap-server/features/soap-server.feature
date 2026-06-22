Feature: SOAP mock server end-to-end (self-hosted)
  restorm hosts a local SOAP mock server AND calls it as a client — no external
  service. Boots restorm with `--mcp`, opens the sample, starts the Calculator
  Mock (assert the Listen toggle flips to the listening state + the served
  banner shows), then runs the Add Consumer against it and asserts the canned
  envelope, runs the Fault Consumer and asserts a SOAP Fault, and finally stops
  the mock.

  Scenario: Host a SOAP mock, consume it in-instance (canned + fault), then stop
    Given I launch restorm with the MCP server enabled
    And I open the SOAP mock sample via MCP
    Then the "Calculator Mock" request shows the SRV badge in the tree

    When I open the "Calculator Mock" request tab via MCP
    And I click the SOAP Listen button
    Then the SOAP Listen button shows the listening state
    And the SOAP mock shows the listening banner

    When I open the "Add Consumer" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response body contains "<result>7</result>"

    When I open the "Fault Consumer" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response body contains "Fault"

    When I open the "Calculator Mock" request tab via MCP
    Then the SOAP mock shows at least 1 request served

    When I click the SOAP Stop button
    Then the SOAP Listen button shows the stopped state
