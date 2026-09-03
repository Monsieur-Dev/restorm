Feature: Design server
  A design's Settings section spins a local HTTP server serving the WHOLE
  design: paginated example lists, single named examples, constraint
  validation of inbound bodies, group-inherited auth, hot-steered forced
  responses from the tab-scoped run panel, and the self-describing
  /swagger.json. The full product loop is exercised: assertions run REAL
  Restorm requests against the served API.

  Scenario: Spin, beam, run panel and stop
    Given a Pro project carrying a servable API design is open on its settings
    When I spin the design server
    Then the run panel opens listing the design routes with zeroed counters
    And the serving beam runs on the design sidebar badge
    When I stop the design server from the run panel
    Then the run panel reports the server stopped

  Scenario: Served responses close the product loop
    Given a Pro project carrying a servable API design is open on its settings
    When I spin the design server
    And I run the "List users" request
    Then the response status is "200"
    And the response body contains "admin@example.com"
    And the response body contains "total"
    When I run the "Get one user" request
    Then the response status is "200"
    And the response body contains "admin@example.com"
    When I run the "Create user (invalid)" request
    Then the response status is "400"
    And the response body contains "password"
    When I run the "List users without auth" request
    Then the response status is "200"
    And the run panel counts calls on the design routes

  Scenario: Hot steering forces a route's response without restart
    Given a Pro project carrying a servable API design is open on its settings
    When I spin the design server
    And I force the "Fetch one user" route to answer 404
    And I run the "Get one user" request
    Then the response status is "404"
    When I reset the "Fetch one user" route to the design response
    And I run the "Get one user" request
    Then the response status is "200"

  Scenario: The served design describes itself
    Given a Pro project carrying a servable API design is open on its settings
    When I spin the design server
    And I run the "Served OpenAPI document" request
    Then the response status is "200"
    And the response body contains "openapi"
    And the response body contains "/v1/users/{id}"
    And the response body contains "http://localhost:7482/api"

  Scenario: An invalid design cannot be served
    Given a Pro project carrying a servable API design is open on its settings
    When I add an unnamed property to the "User" model
    Then the design spin button is disabled
    When I delete the unnamed property of the "User" model
    Then the design spin button is enabled

  Scenario: A port conflict yields a clean error
    Given a Pro project carrying a servable API design is open on its settings
    And the design port is already occupied
    When I try to spin the design server
    Then a design server error mentions the failed start

  Scenario: Serving surfaces the clients callout linking to the Clients section
    Given a Pro project carrying a servable API design is open on its settings
    When I spin the design server
    Then the clients callout links to the Clients section
