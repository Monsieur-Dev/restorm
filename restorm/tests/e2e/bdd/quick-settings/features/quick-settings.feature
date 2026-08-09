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

  Scenario: The pencil button replaces a saved config's values with the current ones
    Given I launch restorm with the MCP server enabled
    And I have a fresh "http" request named "qs-update" populated with its field matrix
    When I open its tab and save a quick config named "to-update"
    Then the storage-target toggle targets the project file by default
    When I change every editable field of the "http" request
    And I update the quick config named "to-update" with the current values
    And I restore the original field matrix of the "http" request
    And I load the quick config named "to-update"
    Then the "http" editor shows the changed values

  Scenario: The auth popover's link-external opens the authentication route in a tab
    Given I launch restorm with the MCP server enabled
    And I have a request with an environment, an in-scope auth route, and a scenario using it
    When I open its tab
    And I open the "auth-key" popover
    And I click the auth popover's open-route link
    Then the authentication route editor is open in the active tab

  Scenario: Opening the auth-key popover dismisses an open quick-config popover, and vice versa
    Given I launch restorm with the MCP server enabled
    And I have a request with an environment, an in-scope auth route, and a scenario using it
    When I open its tab
    And I open the "quick-config" popover
    Then only the "quick-config" popover is open
    When I open the "auth-key" popover
    Then only the "auth-key" popover is open
    When I open the "quick-config" popover
    Then only the "quick-config" popover is open

  Scenario: Opening the environment popover dismisses the other header popovers both ways, and an outside click still closes it
    Given I launch restorm with the MCP server enabled
    And I have a request with an environment, an in-scope auth route, and a scenario using it
    When I open its tab
    And I open the "quick-config" popover
    Then only the "quick-config" popover is open
    When I open the "environment" popover
    Then only the "environment" popover is open
    When I open the "quick-config" popover
    Then only the "quick-config" popover is open
    When I open the "environment" popover
    Then only the "environment" popover is open
    When I open the "auth-key" popover
    Then only the "auth-key" popover is open
    When I open the "environment" popover
    Then only the "environment" popover is open
    When I click outside every popover
    Then no popover is open

  # Yoann's exact rejection repro: he opened the tags (bookmarks) popover, then
  # the scenarios one, then quick settings, and all three stayed open at once.
  # Driving that precise three-way sequence is the specification for the fix.
  Scenario: The tags, scenarios and quick-config popovers are mutually exclusive in Yoann's reported sequence
    Given I launch restorm with the MCP server enabled
    And I have a request with an environment, an in-scope auth route, and a scenario using it
    When I open its tab
    And I open the "tags" popover
    Then only the "tags" popover is open
    When I open the "scenarios" popover
    Then only the "scenarios" popover is open
    When I open the "quick-config" popover
    Then only the "quick-config" popover is open
    When I open the "tags" popover
    Then only the "tags" popover is open

  # The title icon picker renders on a CONTAINER tab (the request leaf carries no
  # icon), so its exclusivity is driven on the env-folder tab against the tag
  # ribbon, which renders on that surface too. Same shared channel, so opening
  # one still dismisses the other both ways.
  Scenario: Opening the title icon picker dismisses an open tag popover on a container tab, and vice versa
    Given I launch restorm with the MCP server enabled
    And I have a request with an environment, an in-scope auth route, and a scenario using it
    When I open the env-folder tab
    And I open the "tags" popover
    Then only the "tags" popover is open
    When I open the "icon" popover
    Then only the "icon" popover is open
    When I open the "tags" popover
    Then only the "tags" popover is open
    When I click outside every popover
    Then no popover is open

  # The statusbar MCP-status indicator lives a full window's length from the
  # request header, yet is the same class of click popover — so it joins the one
  # set. This proves exclusivity reaches across that distance, not just within a
  # row.
  Scenario: The statusbar MCP-status popover and a header popover are mutually exclusive both ways
    Given I launch restorm with the MCP server enabled
    And I have a request with an environment, an in-scope auth route, and a scenario using it
    When I open its tab
    And I open the "statusbar-mcp" popover
    Then only the "statusbar-mcp" popover is open
    When I open the "quick-config" popover
    Then only the "quick-config" popover is open
    When I open the "statusbar-mcp" popover
    Then only the "statusbar-mcp" popover is open
    When I click outside every popover
    Then no popover is open
