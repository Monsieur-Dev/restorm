Feature: WADL import end-to-end

  Scenario: Import the sample spec
    Given a fresh single-file collection for WADL import
    When I import the WADL fixture file "petstore.wadl"
    Then the sidebar should show the imported folder "pets"
    And the sidebar should show the imported folder "{id}"

  Scenario: Re-import is idempotent
    Given a fresh single-file collection for WADL import
    When I import the WADL fixture file "petstore.wadl"
    And I import the WADL fixture file "petstore.wadl"
    Then exactly 1 folder named "pets" should be in the sidebar

  Scenario: Auto-detection picks WADL from the namespace
    Given a fresh single-file collection for WADL import
    When I open the import modal
    And I paste the WADL fixture file "petstore.wadl" into the import source
    Then the import preview should be visible
