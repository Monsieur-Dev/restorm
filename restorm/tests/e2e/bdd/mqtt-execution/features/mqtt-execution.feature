Feature: MQTT execution end-to-end (Docker Mosquitto broker)
  restorm connects to the Mosquitto broker the test stack hosts on
  `localhost:1883` (`tests/docker`). On connect the request subscribes to its
  topic `restorm/e2e/chat`; the Send button publishes the configured payload to
  that same topic, which round-trips straight back through the subscription —
  so a single request both sends and receives. Boots restorm with `--mcp`, opens
  the sample, connects the MQTT Chat request (assert Connect toggles to the
  connected state + enables Send), publishes, asserts the payload shows as both a
  sent bubble AND a received bubble, then disconnects.

  Scenario: Connect to the broker, publish, receive the round-trip, then disconnect
    Given I launch restorm with the MCP server enabled
    And I open the MQTT sample via MCP

    When I open the "MQTT Chat" request tab via MCP
    Then the Send button is disabled
    When I click the Connect button
    Then the Connect button shows the connected state
    And the Send button is enabled

    When I click the Send button
    Then the chat shows a sent message matching "from mqtt"
    And the chat shows a received message matching "from mqtt"

    When I click the Disconnect button
    Then the Connect button shows the disconnected state
    And the Send button is disabled
