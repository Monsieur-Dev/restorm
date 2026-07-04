Feature: STOMP execution end-to-end (docker ActiveMQ)
  STOMP is client-only — it connects to an external broker, so this suite
  targets the docker `rmohr/activemq` mock (`ws://localhost:61614`), unlike
  the self-hosted WebSocket/Socket.IO/MQTT suites. Boots restorm (MCP on by
  default), opens the sample, connects the "STOMP Chat" request (asserting the
  URL resolves the `{{stompHost}}` env variable), sends a message (which
  round-trips back through its own subscription on the same destination),
  asserts the frame stream shows both the sent SEND and the received MESSAGE,
  disconnects (cancelling the live connection — STOMP has no separate cancel
  verb, Disconnect-while-connected IS the cancellation path, same as the
  WebSocket/Socket.IO/MQTT/gRPC connect↔disconnect toggle), and finally
  re-opens the tab to assert the URL input is debounced.
  Opt out with SKIP_STOMP_E2E=1 (mirroring the playbook's per-protocol flag)
  when the docker broker isn't available.

  Scenario: Connect, resolve the env-templated URL, send, receive the round-trip, disconnect, then assert debounce
    Given I launch restorm with the MCP server enabled
    And I open the STOMP sample via MCP

    When I open the "STOMP Chat" request tab via MCP
    Then the STOMP Send button is disabled
    And the STOMP URL resolves to "ws://localhost:61614"

    When I click the STOMP Connect button
    Then the STOMP Connect button shows the connected state
    And the STOMP Send button is enabled

    When I click the STOMP Send button
    Then the STOMP frame stream shows a sent SEND frame matching "from stomp"
    And the STOMP frame stream shows a received MESSAGE frame matching "from stomp"

    When I click the STOMP Disconnect button
    Then the STOMP Connect button shows the disconnected state
    And the STOMP Send button is disabled

    When I type 10 characters into the STOMP URL field within 100 ms
    Then at most 2 STOMP document-update events are emitted
