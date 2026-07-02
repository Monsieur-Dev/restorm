Feature: OpenRPC import — generate + run a JSON-RPC request
  Imports the OpenRPC document the local JSON-RPC mock server (:8095) serves
  at /openrpc.json — a self-describing document whose `servers[0].url`
  points back at the same mock — and runs one of the generated `jsonrpc`
  requests, proving the importer's output is not just structurally correct
  but genuinely executable.

  Background:
    Given I launch restorm with the MCP server enabled

  Scenario: Import an OpenRPC document and run a generated method
    When I import the JSON-RPC mock's OpenRPC document via MCP
    Then the MCP reply reports a successful import
    When I open the "echo" request tab via MCP
    And I click the JSON-RPC Send button
    Then the JSON-RPC response status is 200
