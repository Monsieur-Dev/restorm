Feature: Thunder Client import end-to-end

  Scenario: Import a Thunder Client collection builds the folder hierarchy
    Given a new single-file JSON collection for Thunder Client import
    When I import the Thunder Client fixture file "thunder-collection-sample.json"
    Then the sidebar should show the imported folder "Thunder Client Sample"
    And the sidebar should show the imported folder "Pets"
    And the sidebar should show the imported folder "Admin"

  Scenario: An imported request opens with its method, url, and headers intact
    Given a new single-file JSON collection for Thunder Client import
    When I import the Thunder Client fixture file "thunder-collection-sample.json"
    And I open the imported request "List pets"
    Then the request editor shows method "GET" and url "{{baseUrl}}/pets"
    And the request editor shows a header named "Accept"
