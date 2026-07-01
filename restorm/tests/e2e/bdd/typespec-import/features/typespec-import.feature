Feature: TypeSpec import — compile via tsp, then delegate to the OpenAPI importer
  Covers importing a `.tsp` file end to end: Restorm's own bundled TypeSpec
  compiler compiles it to OpenAPI 3.x, and the existing OpenAPI importer turns
  that into the sidebar tree.

  Scenario: Import a TypeSpec .tsp file builds the same folder shape as its emitted OpenAPI
    Given a new single-file YAML collection for TypeSpec import
    When I import the TypeSpec sample file "petstore.tsp"
    Then the sidebar should show the imported folder "Pet Store"
    And the sidebar should show the imported request "Pets_list"
    And the sidebar should show the imported request "Pets_create"
    And the sidebar should show the imported request "Pets_read"

  Scenario: Re-importing the same .tsp file creates a separate copy
    Given a new single-file YAML collection for TypeSpec import
    When I import the TypeSpec sample file "petstore.tsp"
    And I import the TypeSpec sample file "petstore.tsp"
    Then exactly 2 imported folder named "Pet Store" should be in the sidebar
