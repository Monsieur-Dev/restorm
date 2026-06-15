Feature: Socket.IO execution end-to-end
  Boots restorm with `--mcp`, opens the Socket.IO sample + the Echo request, and
  drives the real UI: assert the Send button is disabled until connected, click
  Connect, emit on the socket (asserting the message bubble + its acknowledgement
  check), push a server->client event over the mock's plain HTTP `/emit` route
  (asserting it lands in the chat), then click Disconnect and assert the buttons
  return to the not-connected state.

  Scenario: Connect, send with ack, receive an HTTP push, then disconnect
    Given I launch restorm with the MCP server enabled
    And I open the Socket.IO sample and the Echo request tab via MCP

    Then the Send button is disabled

    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I click the Send button
    Then the chat shows a sent message matching "world" with an acknowledgement

    When I push to the "echo" event over the HTTP route via MCP
    And I reopen the Echo request tab via MCP
    Then the chat shows a received message matching "from HTTP"

    When I click the Disconnect button
    Then the Connect button shows the disconnected state
    And the Send button is disabled
