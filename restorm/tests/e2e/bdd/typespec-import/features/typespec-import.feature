Feature: TypeSpec import — compile via tsp, then delegate to the OpenAPI importer
  Covers importing a `.tsp` file end to end: the real `tsp` CLI compiles it to
  OpenAPI 3.x, and the existing OpenAPI importer turns that into the sidebar
  tree. Also covers the CLI-not-found error path so a user without
  `@typespec/compiler` installed sees a clear instruction, not a stack trace.

  Scenario: Import a TypeSpec .tsp file builds the same folder shape as its emitted OpenAPI
    Given a new single-file YAML collection for TypeSpec import
    When I import the TypeSpec sample file "petstore.tsp"
    Then the sidebar should show the imported folder "Pet Store"
    And the sidebar should show the imported request "Pets_list"
    And the sidebar should show the imported request "Pets_create"
    And the sidebar should show the imported request "Pets_read"

  Scenario: Re-importing the same .tsp file is idempotent
    Given a new single-file YAML collection for TypeSpec import
    When I import the TypeSpec sample file "petstore.tsp"
    And I import the TypeSpec sample file "petstore.tsp"
    Then exactly 1 imported folder named "Pet Store" should be in the sidebar

  Scenario: Missing tsp CLI surfaces a clear install instruction, not a stack trace
    Given a new single-file YAML collection for TypeSpec import without tsp on PATH
    When I attempt to import the TypeSpec sample file "petstore.tsp"
    Then the import modal should show the error "TypeSpec import requires @typespec/compiler: npm install -g @typespec/compiler"
