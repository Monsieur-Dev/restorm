Feature: Exhaustive documentation viewer behaviour
  Catch-all visual end-to-end suite for the documentation viewer.
  The Background imports the Petstore swagger and patches every
  documentation field (api info, groups, models, properties,
  parameters, responses, security schemes, polymorphism, xml hints,
  vendor extensions) — the same logic the
  `fully-documented-petstore` fixture builder uses. Each scenario
  groups the assertions on a single surface so we keep tight
  failure isolation without paying the ~11 s reload cost per
  individual check.

  Background:
    Given the fully-documented Petstore is loaded into the env-folder Docs tab

  Scenario: Scope header, sidebar, and Overview navigation
    Then the env-folder docs scope title should be "Swagger Petstore"
    And the env-folder docs scope description should be visible
    And the API info section should expose every patched field
    And the API info row should expose the source-format logo aligned right of the dl
    And the sidebar should list every group from the spec
    And every sidebar group header should use a codicon-chevron caret
    And no sidebar group should expose a route-count pastille
    And every operation in the spec should appear under its tag group
    And the sidebar method pill for the GET operation should render with white text
    And the sidebar Models list should contain every model name
    And the sidebar Enums list should contain every enum-bearing model with its enum properties
    When I scroll the docs panel to the bottom
    And I click the sidebar Overview entry
    Then the env-folder docs scope header should be in view
    When I click the sidebar Operation entry "Find pet by ID"
    Then the route block "getPetById" should be in view
    When I click the sidebar Model entry "Pet"
    Then the React Flow node "Pet" should be on screen
    When I click the sidebar Enum entry "Pet" property "status"
    Then the Enums entry "Pet" property "status" should be in view

  Scenario: Tag-folder grouping in env-folder Docs (H2 + description per group)
    Then the env-folder docs body should expose an H2 group header for every tag in the spec
    And each group header should render its description below the title
    And the H1, H2, H3 levels should render at 26, 22, 18 px respectively
    And the sidebar Operations section title should scroll to the first group header
    And the sidebar Models section title should scroll to the Models section
    And the sidebar Enums section title should scroll to the Enums section

  Scenario: Per-route block content, security details, parameters, responses, extras
    Then every operation in the spec should render a route block
    And the route block "getPetById" should show its summary, GET badge, URL pattern, description
    And the route block "getPetById" should show service, op, soapAction discriminants
    And the route block "updatePetWithForm" should show event + direction discriminants
    And the route block "getPetById" should expose operationId, Request body, Response body, Security, External docs in the meta dl
    And the route block "getPetById" should describe scheme "api_key" with location "header"
    And the route block "updatePetWithForm" should describe scheme "petstore_auth" with the implicit flow URL and scopes
    And the parameters table for "getPetById" should include the "petId" row with location, type, format, required, description, example, constraints
    And the parameters table for "getPetById" should expose at least 2 example entries for "petId"
    And the parameters table for "getPetById" should show a format chip on "petId"
    And the responses table for "getPetById" should list every status code from the spec
    And the responses dot for "getPetById" status "200" should look like a 2xx
    And the responses dot for "getPetById" status "404" should look like a 4xx
    When I expand the response row for "getPetById" status "200"
    Then the response detail should expose a schema label, the X-Rate-Limit header, and a JSON and XML example
    When I expand the operation extras for "getPetById"
    Then I should see x-rate-limit, x-internal-only, and x-codegen-tags

  Scenario: Model graph layout, edges, badges, tooltip, polymorphism, enums
    Then the model graph should report layout-ready
    And the model graph should render a node for every model in the spec
    And the first model node should show the deprecated badge
    And the last model node should show the removed badge
    And every patched cross-model reference should produce an edge in the graph
    And no model graph edge should cut across an unrelated node
    When I hover the first property of the "Pet" node
    Then a documentation tooltip should be visible
    And the Composition section should describe the patched discriminator on the first model
    And the Enums section should include "Pet" with a status enum row

  Scenario: Search — Ctrl+F native bar + Ctrl+Shift+F custom bar
    When I press Ctrl+F
    Then the native find bar should be visible
    When I type "pet" in the find input
    And I press F3
    Then the native find bar active match should have advanced
    When I press Escape
    Then the native find bar should be gone
    When I press Ctrl+Shift+F
    And I type "pet" in the search input
    Then the custom search bar counter should report a match count above zero
    When I press F3 enough times to wrap around the match list
    Then the custom search bar active index should be 1

  Scenario: Add-a-request — env-folder + folder scopes
    When I click "Add a request" on operation "deletePet" in the env-folder docs
    Then a request named "Deletes a pet" should appear inside the "pet" folder
    Given I open the "pet" folder Docs tab
    When I click "Add a request" on operation "uploadFile" in the folder docs
    Then a request named "uploads an image" should appear inside the "pet" folder

  # ── Pre-wired auth on imported requests (A1) ──────────────────────────
  #
  # The pre-wiring of `Authorization` / `X-API-Key` headers from
  # `securityDefinitions` is locked in by the unit tests on
  # `applySwagger20SecurityToRequest` / `applyOpenApi3SecurityToRequest`
  # in PR #165. The persisted YAML fixture also exposes the patched
  # values verbatim — see the round-trip assertion in
  # `fully-documented-petstore.steps.ts`. A pure-DOM e2e on top of the
  # request tab proved fragile under the close+reopen + tab-activation
  # timing of the patched flow; tracking as a separate ticket if we
  # need a visual gate.
