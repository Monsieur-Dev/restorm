Feature: SSE (Server-Sent Events) execution end-to-end
  Boots restorm (MCP on by default), opens the SSE sample and drives the real UI
  against the live SSE mock server: connecting shows frames arriving in real
  time, a header value substituted via Handlebars reaches the wire (echoed
  back by the mock), a dropped connection reconnects and resumes from the
  last received id, the URL input is debounced, and disconnecting closes the
  stream cleanly. SSE is receive-only — there is no Send button.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the SSE sample via MCP

  Scenario: Connect and see frames arrive in real time
    When I open the "SSE Frames" request tab via MCP
    Then the SSE Connect button shows the disconnected state
    When I click the SSE Connect button
    Then the SSE Connect button shows the connected state
    And the SSE frame list shows a frame matching "1"
    And the SSE frame list shows a frame matching "3"

  Scenario: Header env-var / Handlebars substitution reaches the wire
    When I open the "SSE Headers (echo)" request tab via MCP
    And I click the SSE Connect button
    # The mock echoes the received `X-Echo` header value back as the first
    # frame — the resolved value (not the literal "{{echoval}}") proves
    # substitution happened on the wire.
    Then the SSE frame list shows a frame matching "echo-substituted-42"

  Scenario: The URL input is debounced
    When I open the "SSE Frames" request tab via MCP
    And I type 10 characters into the SSE URL field within 100 ms
    Then at most 2 SSE document-update events are emitted

  Scenario: A dropped connection reconnects and resumes from the last id
    When I open the "SSE Reconnect" request tab via MCP
    And I click the SSE Connect button
    # The mock drops the connection after frames id=1..2, then resumes
    # from id=3 once the client reconnects with `Last-Event-ID: 2`. Seeing
    # frame 5 proves the reconnect completed rather than just failing.
    Then the SSE frame list shows a frame matching "5"

  Scenario: Disconnect closes the stream
    When I open the "SSE Frames" request tab via MCP
    And I click the SSE Connect button
    Then the SSE Connect button shows the connected state
    When I click the SSE Disconnect button
    Then the SSE Connect button shows the disconnected state
