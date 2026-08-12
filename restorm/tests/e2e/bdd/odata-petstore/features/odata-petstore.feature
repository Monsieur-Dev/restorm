Feature: OData petstore — import + send + filter
  Smoke test for the OData request tab against the in-repo
  AspNetCoreOData petstore (`tests/docker/odata-petstore`, port
  5100). Drives the full pipeline: new-file save, EDMX import via
  the import modal, sidebar navigation to the imported `Pets`
  request, Send for the unfiltered list, then narrow via $filter
  + $select and Send again — verifying the response body shape
  changed between the two calls.

  Scenario: Import metadata, send Pets, filter then send again
    Given a new single-file YAML collection for the OData petstore
    When I open the import modal and paste the OData metadata URL
    And I import the previewed routes
    And I open the "List Pets" request in an OData tab
    And I send the OData request
    Then the OData response body should contain "Rex"
    And the OData response body should contain "Whiskers"
    And the OData response body should contain "PhotoUrls"

    When I narrow the OData query to filter "Name eq 'Rex'" and select "Name"
    And I send the OData request
    Then the OData response body should contain "Rex"
    And the OData response body should not contain "Whiskers"
    And the OData response body should not contain "PhotoUrls"

  Scenario: URL placeholder, live preview and $count react immediately
    # The URL field and the $count toggle write into the reactive request
    # OUTSIDE React state — without a forced render the placeholder stayed
    # painted over the typed text, the resolved-URL preview froze, and
    # $count was inert until some other field changed.
    Given a new single-file YAML collection for the OData petstore
    When I open the import modal and paste the OData metadata URL
    And I import the previewed routes
    And I open the "List Pets" request in an OData tab
    Then the OData URL field shows no placeholder overlay
    When I toggle the OData count option
    Then the OData resolved URL preview should contain "$count=true"
    When I replace the OData URL with "https://svc.example/odata/Pets"
    Then the OData URL field shows no placeholder overlay
    And the OData resolved URL preview should contain "https://svc.example/odata/Pets"
    When I clear the OData URL field
    Then the OData URL placeholder overlay is visible

  Scenario: Metadata-driven $filter autocomplete suggests properties and enum values
    Given a new single-file YAML collection for the OData petstore
    When I open the import modal and paste the OData metadata URL
    And I import the previewed routes
    And I open the "List Pets" request in an OData tab

    # Property position: typing a prefix suggests entity-type properties.
    When I type "Sta" into the OData filter editor
    Then the OData filter suggestion list should contain "Status"
    And I dismiss the OData filter suggestion list

    # Value position after a comparison operator on an enum property
    # suggests the enum members parsed from the metadata.
    When I type "Status eq " into the OData filter editor
    Then the OData filter suggestion list should contain "Available"
    And the OData filter suggestion list should contain "Sold"
    And I dismiss the OData filter suggestion list

    # Handlebars coexistence: an env-templated value survives the
    # odata-filter editor verbatim (the grammar treats {{...}} as an
    # opaque span, so it is neither mangled nor flagged as invalid).
    When I set the OData filter to "Name eq '{{petName}}'"
    Then the OData filter editor should contain "{{petName}}"
    And the OData filter editor should have no validation errors

  Scenario: $batch — GET inside a change-set triggers a serializer warning
    Given a new single-file YAML collection for the OData petstore
    When I open the import modal and paste the OData metadata URL
    And I import the previewed routes
    And I create a new batch request named "test-batch"
    And I add a GET sub-request to the batch with URL "Pets(1)" in change-set "cs1"
    And I send the OData batch request
    Then the batch GET-in-change-set warning should be visible

    When I enable the "Allow GET in change-set" toggle
    And I send the OData batch request
    Then the batch GET-in-change-set warning should not be visible

  Scenario: v4.01 — version selector includes v4.01 and force-absolute-URLs toggle appears in batch mode
    Given a new single-file YAML collection for the OData petstore
    When I open the import modal and paste the OData metadata URL
    And I import the previewed routes
    And I create a new batch request named "batch-v401"
    Then the OData version selector should include "v4.01"
    And the OData version selector should include "v3"
    And the OData version selector should include "v2"

    When I select OData version "v4.01"
    Then the force-absolute-batch-URLs toggle should be visible
