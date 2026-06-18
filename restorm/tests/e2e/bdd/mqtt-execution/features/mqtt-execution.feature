Feature: MQTT execution end-to-end (self-hosted broker)
  restorm HOSTS a local MQTT broker AND connects to it as a client — no external
  Mosquitto. Boots restorm with `--mcp`, opens the sample, starts the MQTT Broker
  (assert Start listening toggles to the listening state + enables Send), opens
  the MQTT Chat client and connects it (which subscribes to `restorm/e2e/chat`),
  publishes from the client (asserting the payload shows as a sent bubble that
  gains a delivery check — its own publish round-trips back through its
  subscription and folds into a delivery confirmation on the sent bubble, not a
  duplicate inbound bubble), then broadcasts from the broker's Send button and
  asserts the client receives it as an inbound bubble, and finally disconnects
  the client.

  Scenario: Host a broker, connect a client, publish, receive the round-trip, broadcast, then disconnect
    Given I launch restorm with the MCP server enabled
    And I open the MQTT sample via MCP

    When I open the "MQTT Broker" request tab via MCP
    Then the Send button is disabled
    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I open the "MQTT Chat" request tab via MCP
    Then the Send button is disabled
    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I click the Send button
    Then the chat shows a sent message matching "from mqtt"
    And that sent message shows a delivery check

    When I open the "MQTT Broker" request tab via MCP
    Then the server shows 1 connected client
    When I click the Send button
    When I open the "MQTT Chat" request tab via MCP
    Then the chat shows a received message matching "from broker"

    When I click the Disconnect button
    Then the Connect button shows the disconnected state
    And the Send button is disabled
