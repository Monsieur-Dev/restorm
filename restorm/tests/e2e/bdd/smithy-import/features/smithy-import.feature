Feature: Smithy import — JSON AST + .smithy IDL, auto-detected

  Scenario: Import the JSON AST builds the resource hierarchy
    Given a new single-file collection for Smithy import
    When I import the Smithy JSON AST fixture file
    Then the sidebar should show the imported folder "Weather"
    And the sidebar should show the imported folder "City"

  Scenario: Pasting the .smithy IDL text is auto-detected without picking a format
    Given a new single-file collection for Smithy import
    When I paste the Smithy IDL text into the import source
    Then the sidebar should show the imported folder "Weather"
    And the sidebar should show the imported folder "City"

  Scenario: Re-importing the JSON AST is idempotent
    Given a new single-file collection for Smithy import
    When I import the Smithy JSON AST fixture file
    And I import the Smithy JSON AST fixture file
    Then exactly 1 folder named "Weather" should be in the sidebar
