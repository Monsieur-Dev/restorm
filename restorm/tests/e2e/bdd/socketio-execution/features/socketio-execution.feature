Feature: Socket.IO execution end-to-end (self-hosted)
  restorm hosts a Socket.IO server AND connects to it as a client — no external
  mock. Boots restorm (MCP on by default), opens the sample, starts the Echo Server
  (assert Start listening toggles to the listening state + enables Send), opens
  the Echo client and connects it, emits on the socket (asserting the sent
  bubble + its acknowledgement check — the server ACKs on reception), then
  broadcasts from the server's Send button and asserts the client receives it,
  and finally disconnects the client.

  Scenario: Host a server, connect a client, ack a send, broadcast, then disconnect
    Given I launch restorm with the MCP server enabled
    And I open the Socket.IO sample via MCP

    When I open the "Echo Server" request tab via MCP
    Then the Send button is disabled
    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I open the "Echo" request tab via MCP
    Then the Send button is disabled
    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I click the Send button
    Then the chat shows a sent message matching "world" with an acknowledgement

    When I open the "Echo Server" request tab via MCP
    And I click the Send button
    When I open the "Echo" request tab via MCP
    Then the chat shows a received message matching "from server"

    When I click the Disconnect button
    Then the Connect button shows the disconnected state
    And the Send button is disabled
