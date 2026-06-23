Feature: OData execution — query options, CRUD, batch, v2 envelope
  Drives the real OData request panel against the in-repo mocks: the v4
  .NET petstore (:5100) and the v2 node mock (:5102, imported from its
  own $metadata URL so baseUrl resolves to the running mock). Covers v4
  query options, the v2 `{ d: { results } }` envelope + `$inlinecount`,
  a self-cleaning create, the JSON `$batch` format (built in this
  ticket), server-driven paging via the next-page button, and an OData
  error envelope. Reaching the mock's seeded data (e.g. "Rex", "Bread")
  proves the Handlebars `{{baseUrl}}` substitution reached the wire.

  Background:
    Given a new single-file YAML collection for OData execution

  # --- Query options (v4) ---------------------------------------------------

  Scenario: v4 $filter + $select narrows the Pets list
    When I import the OData v4 metadata URL
    And I open the OData request "List Pets"
    And I send the OData request
    Then the OData response body should contain "Rex"
    And the OData response body should contain "Whiskers"

    When I set the OData filter to "Name eq 'Rex'" and select "Name"
    And I send the OData request
    Then the OData response body should contain "Rex"
    And the OData response body should not contain "Whiskers"

  # --- v2 envelope ----------------------------------------------------------

  Scenario: v2 import resolves baseUrl to the running mock and surfaces d.results
    When I import the OData v2 metadata URL
    And I open the OData request "List Products"
    And I send the OData request
    Then the OData response body should contain "Bread"
    And the OData response body should contain "Milk"

  Scenario: v2 $inlinecount returns __count in the d wrapper
    When I import the OData v2 metadata URL
    And I open the OData request "List Products"
    And I enable the OData count option
    And I send the OData request
    Then the OData response body should contain "Bread"

  # --- CRUD by-key (GET) ----------------------------------------------------

  Scenario: GET a v2 product by key returns the single entity
    When I import the OData v2 metadata URL
    And I open the OData request "Get Products by ID"
    And I set the OData by-key id to "2"
    And I send the OData request
    Then the OData response body should contain "Milk"

  # --- $batch (JSON format, built in this ticket) ---------------------------

  Scenario: JSON batch with three GET children returns a responses array
    When I import the OData v2 metadata URL
    And I open the OData request "List Products"
    And I switch the request to a JSON batch of three GETs
    And I send the OData request
    Then the OData batch response should have 3 sub-responses
    And the OData batch sub-response 0 body should contain "Bread"

  Scenario: JSON batch change-set rolls back all-or-nothing on a server error
    When I import the OData v2 metadata URL
    And I open the OData request "List Products"
    And I switch the request to a JSON batch change-set with a valid POST and a failing DELETE
    And I send the OData request
    Then the OData batch response should have 2 sub-responses
    And the OData batch sub-response 0 body should contain "ChangeSetFailed"

  # --- Response handling ----------------------------------------------------

  Scenario: v2 server-driven paging exposes a working next-page button
    When I import the OData v2 metadata URL
    And I open the OData request "List Products"
    And I set the OData top to "2"
    And I send the OData request
    Then the OData next-page button should be visible
    When I click the OData next-page button
    Then the OData response body should contain "Eggs"

  # --- Errors ---------------------------------------------------------------

  Scenario: an OData error envelope surfaces its code
    When I import the OData v2 metadata URL
    And I open the OData request "List Products"
    And I point the OData request URL at the v2 mock error path
    And I send the OData request
    Then the OData response body should contain "BadRequest"
