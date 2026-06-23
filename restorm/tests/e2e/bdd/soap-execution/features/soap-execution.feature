Feature: SOAP execution end-to-end
  Boots restorm with the MCP server enabled, opens the SOAP sample, and drives
  the real request panel against the local SOAP mock server (:8091). Each
  scenario opens a request tab by name, clicks Send, and asserts on the response
  panel — exercising simple echo, complex-type input, response headers, SOAP
  Fault surfacing, Handlebars substitution on the wire, cancellation, and history.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the SOAP sample via MCP

  Scenario: Simple echo round-trip
    When I open the "SOAP Echo" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response status is 200
    And the SOAP response body contains "EchoResponse"

  Scenario: Handlebars substitution reaches the wire
    When I open the "SOAP Echo" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response status is 200
    And the SOAP response body contains "hello-handlebars-42"
    And the SOAP response body does not contain "{{echoMessage}}"

  Scenario: URL env-variable substitution
    When I open the "SOAP Echo (env URL)" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response status is 200
    And the SOAP response body contains "EchoResponse"

  Scenario: Complex-type input (calculator Add)
    When I open the "SOAP Add (complex type)" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response status is 200
    And the SOAP response body contains "AddResponse"
    And the SOAP response body contains "10"

  Scenario: SOAP Fault is surfaced distinctly
    When I open the "SOAP Fault" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response panel shows a fault
    And the SOAP fault message contains "Fault triggered for testing"

  Scenario: Response headers are captured and displayed
    When I open the "SOAP Echo" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response status is 200
    And the SOAP response shows a header "x-soap-mock" containing "restorm-soap-server"

  Scenario: An in-flight SOAP call can be cancelled
    When I open the "SOAP Slow (cancel)" request tab via MCP
    And I click the SOAP Send button
    And I click the SOAP Cancel button
    Then the SOAP Send button is visible again

  Scenario: Malformed XML response surfaces a clean error
    When I open the "SOAP Malformed" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response panel shows a malformed XML error

  Scenario: Execution records a history entry that can be replayed
    When I open the "SOAP Echo" request tab via MCP
    And I click the SOAP Send button
    Then the SOAP response status is 200
    And the SOAP request has at least 1 history entry
