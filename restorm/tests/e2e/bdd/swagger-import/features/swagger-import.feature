Feature: Swagger Import with Enum Support
  As a user, I want to import a Swagger spec and have enum
  parameters correctly typed so I can select values from
  a dropdown instead of typing them manually.

  Scenario: Untinted tags render with distinct deterministic hashed backgrounds
    Given a new single-file YAML collection
    When I import the Petstore swagger
    And I add tag "pet" to the active environment folder tab
    And I add tag "store" to the active environment folder tab
    And I add tag "user" to the active environment folder tab
    Then the active environment folder tab renders tags "pet,store,user" with distinct backgrounds
