Feature: OData import — multi-version metadata + JSON-CSDL
  Covers the import half of the OData matrix against the in-repo mocks
  and committed CSDL fixtures: a v4 $metadata URL, a v4 JSON-CSDL file,
  a v2 CSDL file (tagged v2), a v3 CSDL file (tagged v3), and a re-import
  yielding an empty diff. Each import is asserted on the sidebar tree the
  importer produced (entity-set folders + Actions/Functions), proving the
  version-aware parsers (built in this ticket) wire up end to end.

  Scenario: Import a v4 $metadata URL builds entity-set + Actions + Functions folders
    Given a new single-file YAML collection for OData import
    When I import the OData v4 metadata URL
    Then the sidebar should show the imported folder "OData.PetStore.Models"
    And the sidebar should show the imported folder "Pets"
    And the sidebar should show the imported folder "Actions"
    And the sidebar should show the imported folder "Functions"

  Scenario: Import a v4 JSON-CSDL file builds the same folder shape
    Given a new single-file YAML collection for OData import
    When I import the OData fixture file "v4-csdl.json"
    Then the sidebar should show the imported folder "Products"
    And the sidebar should show the imported folder "Categories"
    And the sidebar should show the imported folder "Actions"
    And the sidebar should show the imported folder "Functions"

  Scenario: Import a v2 CSDL file tags the folder v2
    Given a new single-file YAML collection for OData import
    When I import the OData fixture file "v2-metadata.xml"
    Then the sidebar should show the imported folder "Products"
    And the imported root folder should be tagged OData version "v2"

  Scenario: Import a v3 CSDL file tags the folder v3
    Given a new single-file YAML collection for OData import
    When I import the OData fixture file "v3-metadata.xml"
    Then the sidebar should show the imported folder "Suppliers"
    And the imported root folder should be tagged OData version "v3"
