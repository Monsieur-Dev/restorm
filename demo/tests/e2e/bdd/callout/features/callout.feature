Feature: Callout component
  The Callout component displays a message with a variant and an icon.

  Background:
    Given I open the callout tab

  Scenario: Info callout renders variant, default icon and message
    Then callout "callout-info" should have variant "info"
    And callout "callout-info" icon should be "info"
    And callout "callout-info" message should be "Information message"

  Scenario: Warning callout renders variant, default icon and message
    Then callout "callout-warning" should have variant "warning"
    And callout "callout-warning" icon should be "warning"
    And callout "callout-warning" message should be "Warning message"

  Scenario: Error callout renders variant, default icon and message
    Then callout "callout-error" should have variant "error"
    And callout "callout-error" icon should be "error"
    And callout "callout-error" message should be "Error message"

  Scenario: Debug callout renders variant, default icon and message
    Then callout "callout-debug" should have variant "debug"
    And callout "callout-debug" icon should be "bug"
    And callout "callout-debug" message should be "Debug message"

  Scenario: Custom icon overrides the default
    Then callout "callout-custom-icon" should have variant "info"
    And callout "callout-custom-icon" icon should be "rocket"
    And callout "callout-custom-icon" message should be "Custom icon override"

