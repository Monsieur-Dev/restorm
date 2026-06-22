Feature: GraphQL execution end-to-end
  Boots restorm with the MCP server, opens the GraphQL sample, and drives the
  real request panel against the Docker Apollo server (:4000). Covers the
  full execution matrix: queries (simple, nested, alias, fragment, directive),
  mutations (scalar + object variables), env-var Handlebars substitution on
  URL / headers / query / variables, introspection, error cases (GraphQL
  errors[], network-down), cancellation, and response history.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the GraphQL sample via MCP

  Scenario: Simple query returns user list
    When I open the "Users query" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "Alice"

  Scenario: Nested fields and alias
    When I open the "User with nested and alias" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "\"a\""

  Scenario: Named fragment
    When I open the "User with named fragment" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "alice@example.com"

  Scenario: Inline fragment
    When I open the "User with inline fragment" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "Bob"

  Scenario: Directives @include and @skip
    When I open the "Directives include skip" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "alice@example.com"
    And the GraphQL response editor does not contain "\"name\""

  Scenario: Env-var substitution in variable values reaches the wire
    When I open the "Echo env variable" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "hello-from-env"
    And the GraphQL response editor does not contain "{{greeting}}"

  Scenario: Env-var substitution in header reaches the wire
    When I open the "Echo header auth" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "env-secret-token"
    And the GraphQL response editor does not contain "{{token}}"

  Scenario: Mutation with scalar and object variables
    When I open the "Create user mutation" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "Test User"

  Scenario: Missing required variable surfaces a GraphQL error
    When I open the "Missing required variable" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response shows GraphQL errors

  Scenario: Malformed query surfaces a GraphQL error without crash
    When I open the "Malformed query" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response shows GraphQL errors

  Scenario: Introspection query renders schema data
    When I open the "Introspection" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "__schema"

  Scenario: Network error is handled cleanly
    When I open the "Network error" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response shows a network error

  Scenario: Cancelling a request in flight surfaces cancellation
    When I open the "Slow cancel" request tab via MCP
    And I click the GraphQL Send button
    And I click the GraphQL Cancel button
    Then the GraphQL response shows "Request cancelled"

  Scenario: The query editor is debounced
    When I open the "Users query" request tab via MCP
    And I type 10 characters into the GraphQL query editor within 100 ms
    Then at most 2 GraphQL document-update events are emitted

  Scenario: Response history records success and failure entries
    When I open the "Users query" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response editor contains "Alice"
    When I open the "Missing required variable" request tab via MCP
    And I click the GraphQL Send button
    Then the GraphQL response shows GraphQL errors
    And the request has a GraphQL history entry for "Users query"
