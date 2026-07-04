Feature: gRPC execution end-to-end
  Boots restorm (MCP on by default), opens the gRPC sample and drives the real UI
  against the live grpcbin server across all the call types: a unary call shows
  its response, a server-streaming call surfaces each echoed frame, and a
  bidirectional call connects, sends a frame, receives the echo and disconnects.
  A streaming RPC has no event names — every received frame is a plain message.

  It also covers the wire-transport toggle: the same DummyUnary call dispatched
  over gRPC-Web (binary framing, a dedicated mock container) and over
  Connect-RPC (JSON over HTTP, a dedicated mock container), plus the
  transport SelectBox itself cycling through all three options.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the gRPC sample via MCP

  Scenario: Invoke a unary call and see the response
    When I open the "gRPC Unary" request tab via MCP
    And I click the gRPC Invoke button
    Then the gRPC response shows a message matching "ping"

  Scenario: Metadata env-var / Handlebars substitution reaches the wire
    When I open the "gRPC Headers (metadata echo)" request tab via MCP
    And I click the gRPC Invoke button
    # grpcbin echoes the received metadata; the resolved value (not the literal
    # "{{echoval}}") proves substitution happened on the wire.
    Then the gRPC response shows a message matching "echo-substituted-42"

  Scenario: The URL input is debounced
    When I open the "gRPC Unary" request tab via MCP
    And I type 10 characters into the gRPC URL field within 100 ms
    Then at most 2 gRPC document-update events are emitted

  Scenario: Server-streaming surfaces each received frame
    When I open the "gRPC Echo (server stream)" request tab via MCP
    And I click the gRPC Connect button
    Then the gRPC chat shows a received message matching "stream-me"

  Scenario: Client-streaming sends a frame on the open call
    When I open the "gRPC Echo (client stream)" request tab via MCP
    And I click the gRPC Connect button
    And I click the gRPC Send button
    Then the gRPC chat shows a sent message matching "chunk"

  Scenario: Connect a bidi stream, send a frame and receive the echo, then disconnect
    When I open the "gRPC Echo (bidi)" request tab via MCP
    Then the gRPC Send button is disabled

    When I click the gRPC Connect button
    Then the gRPC Connect button shows the connected state
    And the gRPC Send button is enabled

    When I click the gRPC Send button
    Then the gRPC chat shows a received message matching "hello"

    When I click the gRPC Disconnect button
    Then the gRPC Connect button shows the disconnected state
    And the gRPC Send button is disabled

  Scenario: A non-OK gRPC status surfaces a readable label and raw code
    # Exercises the executeUnary error branch: SpecificError returns code 3
    # (INVALID_ARGUMENT). The response panel must show the non-OK raw code,
    # the human-readable label from grpcStatusName(), and the error message text.
    When I open the "gRPC Error (SpecificError)" request tab via MCP
    And I click the gRPC Invoke button
    Then the gRPC response shows a non-OK status code 3
    And the gRPC response shows the status label "INVALID_ARGUMENT"
    And the gRPC response error text contains "e2e-error-mapping-test"

  Scenario: Cancel a server-stream mid-flight and see the disconnected state
    # Exercises the disconnect()/cancel() path on a server-stream: connect,
    # receive at least one frame, then disconnect — the Connect button must
    # return to the disconnected (plugged) state, confirming the call ended.
    When I open the "gRPC Echo (server stream)" request tab via MCP
    And I click the gRPC Connect button
    Then the gRPC chat shows a received message matching "stream-me"
    And the gRPC Connect button shows the connected state

    When I click the gRPC Disconnect button
    Then the gRPC Connect button shows the disconnected state

  Scenario: Invoke a unary call over gRPC-Web and see the decoded response
    # Same DummyUnary call as "gRPC Unary", framed for plain HTTP/1.1 against
    # the dedicated `grpcweb-mock` container (9002) — grpcbin itself doesn't
    # speak gRPC-Web on any port.
    When I open the "gRPC-Web Unary" request tab via MCP
    And I click the gRPC Invoke button
    Then the gRPC response shows a message matching "web-ping"
    And the gRPC response shows an OK status

  Scenario: Invoke a unary call over Connect-RPC and see a green response
    # Same DummyUnary call again, JSON-over-HTTP against the dedicated
    # connect-mock container.
    When I open the "Connect Unary" request tab via MCP
    And I click the gRPC Invoke button
    Then the gRPC response shows a message matching "connect-ping"
    And the gRPC response shows an OK status

  Scenario: The transport toggle cycles through gRPC, gRPC-Web and Connect
    When I open the "gRPC Unary" request tab via MCP
    Then the gRPC transport select shows "gRPC"

    When I set the gRPC transport to "gRPC-Web"
    Then the gRPC transport select shows "gRPC-Web"

    When I set the gRPC transport to "Connect"
    Then the gRPC transport select shows "Connect"

    When I set the gRPC transport to "gRPC"
    Then the gRPC transport select shows "gRPC"
