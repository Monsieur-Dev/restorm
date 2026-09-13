Feature: OpenAPI 3.x Import

  Scenario: OpenAPI 3.0 spec produces a tagged folder structure
    Given a new single-file YAML collection
    When I import the OpenAPI 3.0 Petstore spec
    Then the sidebar should contain an environment folder named "Petstore"
    And the environment folder "Petstore" should expose a sub-folder named "pet"

  Scenario: OpenAPI 3.1 webhooks block becomes a documentation-only folder
    Given a new single-file YAML collection
    When I import the OpenAPI 3.1 Petstore spec
    Then the environment folder "Petstore 3.1" should expose a sub-folder named "Webhooks"

  Scenario: A one-line JSON spec pasted into the empty source field is pretty-printed
    Given a new single-file YAML collection
    When I paste the minified OpenAPI 3.0 Petstore spec into the import source field
    Then the import source opens in the editor on several lines
    And the import source editor has the keyboard focus
    And the import preview lists the spec's routes
