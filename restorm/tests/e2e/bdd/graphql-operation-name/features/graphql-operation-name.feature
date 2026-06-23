Feature: GraphQL operationName / multi-operation selection
  When a GraphQL query document declares more than one named operation,
  GraphQL-over-HTTP requires an explicit operationName. Restorm surfaces a
  selector in the request panel populated from the parsed operation names; the
  user's pick persists on the request and round-trips through disk. A
  single-operation document shows no selector.

  Background:
    Given I launch restorm with the MCP server enabled
    And I create a GraphQL request with a multi-operation document via MCP

  Scenario: The operation selector appears with one entry per named operation
    When I open the GraphQL request tab via MCP
    Then the GraphQL operation selector lists "GetUser", "ListUsers" and "CreateUser"

  Scenario: Picking an operation persists it on the request
    When I open the GraphQL request tab via MCP
    And I select the GraphQL operation "CreateUser"
    Then the persisted GraphQL request operationName is "CreateUser"

  Scenario: A single-operation document shows no selector
    When I replace the GraphQL document with a single operation via MCP
    And I open the GraphQL request tab via MCP
    Then the GraphQL operation selector is not shown
    And the persisted GraphQL request operationName is cleared
