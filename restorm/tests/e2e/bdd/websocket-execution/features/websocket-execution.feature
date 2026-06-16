Feature: Raw WebSocket execution end-to-end (self-hosted)
  restorm hosts a raw WebSocket server AND connects to it as a client — no
  external mock. Boots restorm with `--mcp`, opens the sample, starts the WS Echo
  Server (assert Start listening toggles to the listening state + enables Send),
  opens the WS Echo client and connects it, sends a frame (asserting the sent
  bubble — a raw socket has no acknowledgement), then broadcasts from the
  server's Send button and asserts the client receives it, and finally
  disconnects the client.

  Scenario: Host a server, connect a client, send a frame, broadcast, then disconnect
    Given I launch restorm with the MCP server enabled
    And I open the WebSocket sample via MCP

    When I open the "WS Echo Server" request tab via MCP
    Then the Send button is disabled
    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I open the "WS Echo" request tab via MCP
    Then the Send button is disabled
    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I click the Send button
    Then the chat shows a sent message matching "world"

    When I open the "WS Echo Server" request tab via MCP
    Then the server shows 1 connected client
    When I click the Send button
    When I open the "WS Echo" request tab via MCP
    Then the chat shows a received message matching "from server"

    When I click the Disconnect button
    Then the Connect button shows the disconnected state
    And the Send button is disabled
