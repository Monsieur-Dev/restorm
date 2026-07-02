Feature: Scenario run-log end-to-end

  Launches restorm on the scenarios reference-tests sample, opens a finished
  scenario, runs it through the real engine, then drives the inspector exactly
  as a user would — flips the "show all logs" toggle so every engine + user
  entry is visible and clicks the copy button — and asserts the copied YAML
  matches a committed golden. This guards the whole run-log pipeline (engine
  events → renderer run-log → YAML copy), not just a pure function.

  Logs / Arithmetics / Loops / Inputs/outputs / Conditions are LEAF scenarios.
  Main is the ORCHESTRATOR — it chains all five sub-scenarios (`done`→`in`) and
  its merged run-log interleaves the sub-runs' entries with its own. That merge
  is ordered by a monotonic per-emission `seq` (not the millisecond `ts`), so a
  sub-run entry and its parent's post-call entry keep their causal order even
  when they share a millisecond — making Main's log deterministic and snapshot-
  testable. (Before `seq`, the ts-only sort tie-broke arbitrarily and Main's log
  was non-deterministic, which is why it used to be excluded here.)

  Scenario Outline: The <scenario> scenario run-log matches the snapshot
    Given I open the scenarios reference-tests sample
    When I run the scenario "<scenario>" and copy all its logs
    Then the copied run-log matches the snapshot

    Examples:
      | scenario       |
      | Logs           |
      | Toast          |
      | Arithmetics    |
      | Loops          |
      | Inputs/outputs |
      | Conditions     |
      | Casts          |
      | Regex          |
      | JSON           |
      | Crypto         |
      | JWT            |
      | DateTime       |
      | XML            |
      | YAML           |
      | Auth login     |
      | Object ops     |
      | URL            |
      | Random         |
      | Throw          |
      | Retry          |
      | List ops       |
      | CSV            |
      | Math           |
      | Schema         |
      | Files          |
      | Timer          |
      | Code TypeScript |
      | Code JavaScript |
      | Code Python    |
      | Code Lua       |
      | Code Ruby      |
      | Code R         |
      | Code C#        |
      | Socket.IO      |
      | WebSocket      |
      | gRPC unary     |
      | gRPC server stream |
      | gRPC client stream |
      | gRPC bidi      |
      | MQTT           |
      | HTTP Server    |
      | gRPC Server    |
      | SOAP Server    |
      | GraphQL Server |
      | OData Server   |
      | GraphQL Subscription |
      | GraphQL unary  |
      | SSE            |
      | Quick config   |
      | Main           |
