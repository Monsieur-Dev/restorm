Feature: Raw WebSocket execution end-to-end
  Boots restorm with `--mcp`, opens the raw-WebSocket sample + the WS Echo
  request, and drives the real UI: assert the Send button is disabled until
  connected, click Connect, send the payload and assert the server echoes it
  straight back (a raw socket has no acknowledgement), push a server->client
  frame over the mock's plain HTTP `/push` route (asserting it lands in the
  chat), then click Disconnect and assert the buttons return to the
  not-connected state.

  Scenario: Connect, send and receive the echo, receive an HTTP push, then disconnect
    Given I launch restorm with the MCP server enabled
    And I open the WebSocket sample and the WS Echo request tab via MCP

    Then the Send button is disabled

    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I click the Send button
    Then the chat shows a received message matching "world"

    When I push a frame over the HTTP route via MCP
    And I reopen the WS Echo request tab via MCP
    Then the chat shows a received message matching "from HTTP"

    When I click the Disconnect button
    Then the Connect button shows the disconnected state
    And the Send button is disabled
