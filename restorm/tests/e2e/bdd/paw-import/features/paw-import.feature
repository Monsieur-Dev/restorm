Feature: Paw JSON export import

  Scenario: Import a Paw JSON export builds the folder + request tree
    Given a new single-file YAML collection for Paw import
    When I import the Paw sample export
    Then the sidebar should show the imported folder "Paw Import"
    And the sidebar should show the imported folder "Pets"
    And the sidebar should show the imported request "Get pet by id"

  Scenario: The imported request runs successfully against the live API
    Given a new single-file YAML collection for Paw import
    When I import the Paw sample export
    And I open the imported request "Get pet by id"
    And I click Send
    Then the response status is "200"
    And the response body contains "Cat 1"

  Scenario: Re-import is idempotent
    Given a new single-file YAML collection for Paw import
    When I import the Paw sample export
    And I import the Paw sample export
    Then exactly 1 folder named "Paw Import" should be in the sidebar
