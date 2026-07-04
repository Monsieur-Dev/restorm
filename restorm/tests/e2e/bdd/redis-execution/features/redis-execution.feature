Feature: Redis execution end-to-end (Docker mock)
  restorm connects to the `redis:7-alpine` Docker mock (`tests/docker/docker-compose.yml`,
  `redis://localhost:6379`) both in subscribe mode and command mode. Boots restorm
  (MCP on by default), opens the sample, subscribes to a channel, publishes to it
  from a separate command-mode request (asserting the subscribed tab shows the
  published payload as a stream frame), then round-trips a value through SET/GET
  (asserting the command REPL shows the read-back reply), and finally unsubscribes.

  Scenario: Subscribe, publish from a command-mode request, and read the round-trip
    Given I launch restorm with the MCP server enabled
    And I open the Redis sample via MCP

    When I open the "Redis Subscribe" request tab via MCP
    And I click the Redis run button
    Then the Redis run button shows the subscribed state

    When I open the "Redis Publish" request tab via MCP
    And I click the Redis run button
    Then the Redis command REPL shows a reply for "PUBLISH restorm-e2e-chat hello from redis"

    When I open the "Redis Subscribe" request tab via MCP
    Then the Redis response shows a stream frame on channel "restorm-e2e-chat" matching "hello from redis"

    When I click the Redis run button
    Then the Redis run button shows the unsubscribed state

  Scenario: Round-trip a value through SET then GET (command REPL read-back)
    Given I launch restorm with the MCP server enabled
    And I open the Redis sample via MCP

    When I open the "Redis Set" request tab via MCP
    And I click the Redis run button
    Then the Redis command REPL shows a reply for "SET e2e-key e2e-value"

    When I open the "Redis Get" request tab via MCP
    And I click the Redis run button
    Then the Redis command REPL shows a reply matching "e2e-value"
