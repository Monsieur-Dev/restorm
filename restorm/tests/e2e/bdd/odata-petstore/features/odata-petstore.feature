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
