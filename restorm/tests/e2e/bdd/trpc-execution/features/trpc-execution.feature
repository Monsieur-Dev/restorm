Feature: tRPC execution end-to-end
  Boots restorm with the MCP server, opens the tRPC sample, and drives the
  real request panel against the hand-rolled mock server (:8096). Covers the
  full execution matrix: a query, a mutation, a tRPC-level error, response
  history, env-var Handlebars substitution on a header, cancellation, and
  input debouncing.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the tRPC sample via MCP

  Scenario: Query returns the unwrapped result data
    When I open the "Get user" request tab via MCP
    And I click the tRPC Send button
    Then the tRPC response editor contains "Alice"

  Scenario: Mutation returns the unwrapped result data
    When I open the "Create post" request tab via MCP
    And I click the tRPC Send button
    Then the tRPC response editor contains "Hello from restorm"

  Scenario: A tRPC-level error surfaces without crashing
    When I open the "Missing user" request tab via MCP
    And I click the tRPC Send button
    Then the tRPC response editor contains "NOT_FOUND"

  Scenario: Show raw envelope toggle reveals the full wire payload
    When I open the "Get user" request tab via MCP
    And I click the tRPC Send button
    Then the tRPC response editor contains "Alice"
    And the tRPC response editor does not contain "\"result\""
    When I toggle the tRPC raw envelope switch
    Then the tRPC response editor contains "\"result\""

  Scenario: Env-var substitution in a header reaches the wire
    When I open the "Echo header auth" request tab via MCP
    And I click the tRPC Send button
    Then the tRPC response editor contains "env-secret-token"
    And the tRPC response editor does not contain "{{token}}"

  Scenario: Cancelling a request in flight surfaces cancellation
    When I open the "Slow cancel" request tab via MCP
    And I click the tRPC Send button
    And I click the tRPC Cancel button
    Then the tRPC response editor contains "Request cancelled"

  Scenario: The input editor is debounced
    When I open the "Get user" request tab via MCP
    And I type 10 characters into the tRPC input editor within 100 ms
    Then at most 2 tRPC document-update events are emitted

  Scenario: Response history records success and error entries
    When I open the "Get user" request tab via MCP
    And I click the tRPC Send button
    Then the tRPC response editor contains "Alice"
    When I open the "Missing user" request tab via MCP
    And I click the tRPC Send button
    Then the tRPC response editor contains "NOT_FOUND"
    And the request has a tRPC history entry for "Get user"

  Scenario: Router introspection import creates one request per procedure
    When I import the tRPC schema URL via the sample
    Then the imported folder contains a request for "user.get"
    And the imported folder contains a request for "post.create"
