Feature: AMQP execution end-to-end (RabbitMQ Docker mock)
  Unlike MQTT (self-hosted), AMQP has no server-capable request — the sample
  connects to the `rabbitmq` Docker mock instead. AMQP v1 is read-only (no
  declare/delete), so the target queue (`restorm-e2e-queue`) is pre-declared
  on the broker via `tests/docker/rabbitmq-definitions.json`. Boots restorm
  (MCP on by default), opens the sample, connects "AMQP Subscribe" (which
  consumes the pre-declared queue), publishes from "AMQP Publish" (to the
  default exchange, routing key = the queue name — no binding needed), and
  asserts the message arrives on the subscriber, then disconnects it.

  Scenario: Connect a subscriber, publish, receive the message, then disconnect
    Given I launch restorm with the MCP server enabled
    And I open the AMQP sample via MCP

    When I open the "AMQP Subscribe" request tab via MCP
    Then the AMQP Connect button is disconnected
    When I click the AMQP Connect button
    Then the AMQP Connect button shows the connected state

    When I open the "AMQP Publish" request tab via MCP
    When I click the AMQP Send button
    Then the AMQP response shows a sent message matching "from amqp"

    When I open the "AMQP Subscribe" request tab via MCP
    Then the AMQP response shows a received message matching "from amqp"

    When I click the AMQP Connect button
    Then the AMQP Connect button shows the disconnected state
