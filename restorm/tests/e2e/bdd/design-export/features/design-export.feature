Feature: Design descriptor export
  The design's Settings carry a descriptor-format combo with a download
  button beside it. OpenAPI 3.1 is the first format: the exported
  document is spec-valid, carries the design's models/enums/routes with
  spec-spelled paths, and never leaks x-restorm extensions or design
  intents. The loop closes over the network: the spec SERVED by the
  design server re-imports as a plain API.

  Scenario: Export a valid OpenAPI 3.1 descriptor from the Settings
    Given a Pro project carrying an API design is open on its export settings
    When I download the design descriptor as "OpenAPI 3.1"
    Then the exported file is a valid OpenAPI 3.1 document
    And the exported document carries the design's routes and components
    And the exported document carries no design intents
    And the export status reports the saved file

  Scenario: Import, derive a design, export — the chain holds
    Given a Pro project with the imported Petstore spec and its derived design
    When I download the design descriptor as "OpenAPI 3.1"
    Then the exported document matches the imported Petstore shape

  Scenario: The served design re-imports over the network
    Given a Pro project carrying an API design is open on its export settings
    When I spin the design server from the settings
    And I import the served descriptor from "http://localhost:7482/swagger.json"
    Then the sidebar carries an imported environment folder named "Petstore"
