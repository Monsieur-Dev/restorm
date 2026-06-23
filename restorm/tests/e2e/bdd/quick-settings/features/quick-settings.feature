Feature: Quick-settings save/load round-trips every field of every protocol
  The request smartbar's quick-settings popover saves the current request's
  fields as a named config and restores them on Load. This must work for EVERY
  editable field of EVERY protocol, and — crucially — the OPEN editor must
  visually re-sync to the loaded values (not just the underlying model). The
  per-protocol scenarios populate a fresh request, save a config, change every
  field in the editor, Load the saved config, and assert the rendered editor
  shows the originally-saved values again. This is the regression lock for the
  transport-replaced re-sync path (the half that exposed the gRPC-metadata,
  WebSocket-headers + MQTT-panel, and Auth-produced-headers gaps).

  Scenario: HTTP — url / method / headers / params survive a save→change→load
    Given I launch restorm with the MCP server enabled
    And I have a fresh "http" request named "qs-http" populated with its field matrix
    When I open its tab and save a quick config named "saved-http"
    And I change every editable field of the "http" request
    And I load the quick config named "saved-http"
    Then the "http" editor shows the originally-saved values

  Scenario: GraphQL — url / query / variables / headers survive a save→change→load
    Given I launch restorm with the MCP server enabled
    And I have a fresh "graphql" request named "qs-graphql" populated with its field matrix
    When I open its tab and save a quick config named "saved-graphql"
    And I change every editable field of the "graphql" request
    And I load the quick config named "saved-graphql"
    Then the "graphql" editor shows the originally-saved values

  Scenario: SOAP — url / body / headers survive a save→change→load
    Given I launch restorm with the MCP server enabled
    And I have a fresh "soap" request named "qs-soap" populated with its field matrix
    When I open its tab and save a quick config named "saved-soap"
    And I change every editable field of the "soap" request
    And I load the quick config named "saved-soap"
    Then the "soap" editor shows the originally-saved values

  Scenario: gRPC — url / message / callType / metadata survive a save→change→load
    Given I launch restorm with the MCP server enabled
    And I have a fresh "grpc" request named "qs-grpc" populated with its field matrix
    When I open its tab and save a quick config named "saved-grpc"
    And I change every editable field of the "grpc" request
    And I load the quick config named "saved-grpc"
    Then the "grpc" editor shows the originally-saved values

  Scenario: OData — url / query-options survive a save→change→load
    Given I launch restorm with the MCP server enabled
    And I have a fresh "odata" request named "qs-odata" populated with its field matrix
    When I open its tab and save a quick config named "saved-odata"
    And I change every editable field of the "odata" request
    And I load the quick config named "saved-odata"
    Then the "odata" editor shows the originally-saved values

  Scenario: WebSocket — url / event / message / headers survive a save→change→load
    Given I launch restorm with the MCP server enabled
    And I have a fresh "websocket" request named "qs-ws" populated with its field matrix
    When I open its tab and save a quick config named "saved-ws"
    And I change every editable field of the "websocket" request
    And I load the quick config named "saved-ws"
    Then the "websocket" editor shows the originally-saved values

  Scenario: MQTT — the 11 MqttOptionsPanel fields survive a save→change→load
    Given I launch restorm with the MCP server enabled
    And I have a fresh "mqtt" request named "qs-mqtt" populated with its field matrix
    When I open its tab and save a quick config named "saved-mqtt"
    And I change every editable field of the "mqtt" request
    And I load the quick config named "saved-mqtt"
    Then the "mqtt" editor shows the originally-saved values

  Scenario: Auth — method / url / producedHeaders / expiration / error-codes survive a save→change→load
    Given I launch restorm with the MCP server enabled
    And I have a fresh "auth" request named "qs-auth" populated with its field matrix
    When I open its tab and save a quick config named "saved-auth"
    And I change every editable field of the "auth" request
    And I load the quick config named "saved-auth"
    Then the "auth" editor shows the originally-saved values
