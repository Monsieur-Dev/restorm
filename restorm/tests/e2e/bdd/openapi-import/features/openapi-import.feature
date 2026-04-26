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
