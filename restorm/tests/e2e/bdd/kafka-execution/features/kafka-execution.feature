Feature: Kafka execution end-to-end
  Boots restorm with the MCP server enabled, opens the Kafka sample, and drives
  the real request panel against the local `restorm-kafka` mock broker (:9092,
  KRaft single-node, seeded with the `restorm-test` topic — 3 messages, 1
  partition). Kafka has no persistent per-request connection: produce is a
  one-shot connect -> send -> disconnect, consume is a long-lived consumer
  group, browse peeks without joining a group. Exercises produce, consume
  (streaming), mode switching, Handlebars substitution on the broker URL,
  input debouncing, and response history.

  Background:
    Given I launch restorm with the MCP server enabled
    And I open the Kafka sample via MCP

  Scenario: Produce a record to the mock broker
    When I open the "Kafka Produce" request tab via MCP
    And I click the Kafka Produce button
    Then the Kafka request has at least 1 history entry
    And that history entry succeeded

  Scenario: Handlebars substitution on the broker URL reaches the wire
    When I open the "Kafka Produce" request tab via MCP
    And I click the Kafka Produce button
    Then the Kafka request has at least 1 history entry
    And that history entry succeeded

  Scenario: Consume replays the seeded messages from the earliest offset
    # The prior two scenarios already produced to this shared topic — reseed
    # it so this scenario deterministically sees exactly the 3 seed messages,
    # regardless of run order or of leftovers from earlier local runs.
    Given the restorm-test Kafka topic is freshly reseeded
    When I open the "Kafka Consume" request tab via MCP
    And I click the Kafka Consume button
    Then the Kafka response panel shows 3 message frames
    When I click the Kafka Consume button
    Then the Kafka Consume button reverts to the idle state

  Scenario: Consume with no new records stays live, then delivers a live-produced record
    # Yoann's exact manual flow: start consuming from the latest offset with no
    # producer running, and the consumer must STAY live (not self-revert to idle
    # a few seconds after the group join) — then a record produced afterwards
    # must arrive live, and Stop must leave the group cleanly.
    Given the restorm-test Kafka topic is freshly reseeded
    When I open the "Kafka Consume Latest" request tab via MCP
    And I click the Kafka Consume button
    Then the Kafka Consume button stays in the consuming state
    And the activity beam runs on the consume button, the tab badge and the sidebar badge
    And the Kafka response panel shows 0 message frames
    When a record is produced to the restorm-test topic
    Then the Kafka response panel shows at least 1 message frame
    When I click the Kafka Consume button
    Then the Kafka Consume button reverts to the idle state

  Scenario: Switching mode swaps the request pane
    When I open the "Kafka Produce" request tab via MCP
    Then the Kafka mode selector reads "produce"
    When I select the Kafka mode "consume"
    Then the Kafka mode selector reads "consume"

  Scenario: Run multiple produces and inspect history
    When I open the "Kafka Produce" request tab via MCP
    And I click the Kafka Produce button
    And I click the Kafka Produce button
    And I click the Kafka Produce button
    Then the Kafka request has at least 3 history entries

  # MANDATORY — see Playbook Section 4.
  Scenario: Inputs are debounced
    When I open the "Kafka Produce" request tab via MCP
    And I type 10 characters into the Kafka broker URL field within 100 ms
    Then at most 2 document-update events are emitted for the request
