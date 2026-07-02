Feature: JSON-RPC 2.0 execution end-to-end
  Boots restorm with the MCP server enabled, opens the JSON-RPC sample, and
  drives the real request panel against the local JSON-RPC mock server
  (:8095). Each scenario opens a request tab by name, clicks Send, and
  asserts on the response panel — exercising positional/named params,
  Handlebars substitution on the wire, the distinct error/notification
  states, cancellation, debounce, history, and the batch child-result view.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the JSON-RPC sample via MCP

  Scenario: Positional-params echo round-trip
    When I open the "JSON-RPC Echo" request tab via MCP
    And I click the JSON-RPC Send button
    Then the JSON-RPC response status is 200
    And the JSON-RPC response body contains "hello-handlebars-42"

  Scenario: Handlebars substitution reaches the wire
    When I open the "JSON-RPC Echo" request tab via MCP
    And I click the JSON-RPC Send button
    Then the JSON-RPC response status is 200
    And the JSON-RPC response body contains "hello-handlebars-42"
    And the JSON-RPC response body does not contain "{{echoMessage}}"

  Scenario: URL env-variable substitution
    When I open the "JSON-RPC Echo (env URL)" request tab via MCP
    And I click the JSON-RPC Send button
    Then the JSON-RPC response status is 200
    And the JSON-RPC response body contains "env-url-test"

  Scenario: Named-params round-trip
    When I open the "JSON-RPC Named Echo" request tab via MCP
    And I click the JSON-RPC Send button
    Then the JSON-RPC response status is 200
    And the JSON-RPC response body contains "restorm"

  Scenario: A JSON-RPC error is surfaced distinctly from a transport error
    When I open the "JSON-RPC Fail" request tab via MCP
    And I click the JSON-RPC Send button
    Then the JSON-RPC response panel shows an error
    And the JSON-RPC error message contains "failMethod always fails"

  Scenario: Notification mode sends no response body
    When I open the "JSON-RPC Notification" request tab via MCP
    And I click the JSON-RPC Send button
    Then the JSON-RPC response panel shows "Notification sent"

  Scenario: An in-flight JSON-RPC call can be cancelled
    When I open the "JSON-RPC Slow (cancel)" request tab via MCP
    And I click the JSON-RPC Send button
    And I click the JSON-RPC Cancel button
    Then the JSON-RPC Send button is visible again

  Scenario: The params editor is debounced
    When I open the "JSON-RPC Echo" request tab via MCP
    And I type 10 characters into the JSON-RPC params editor within 100 ms
    Then at most 2 JSON-RPC document-update events are emitted

  Scenario: Execution records a history entry that can be replayed
    When I open the "JSON-RPC Echo" request tab via MCP
    And I click the JSON-RPC Send button
    And I click the JSON-RPC Send button
    And I click the JSON-RPC Send button
    Then the JSON-RPC request has at least 3 history entries

  Scenario: A batch of children renders one result block per child
    When I open the "JSON-RPC Batch" request tab via MCP
    And I click the JSON-RPC Batch Send button
    Then the JSON-RPC batch response status is 200
    And the JSON-RPC batch response has 3 child result blocks
    And JSON-RPC batch child 2 shows an error
