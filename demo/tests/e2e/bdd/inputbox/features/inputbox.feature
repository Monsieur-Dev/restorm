Feature: InputBox component
  InputBox provides a themed input with validation and accessibility hooks.

  Background:
    Given I open the input box tab

  Scenario: Basic input can be set via shared value input
    When I set input box value input to "Hello {{foo}} xyz"
    When I apply input box value to "basic"
    Then input box "inputbox-basic" value should be "Hello {{foo}} xyz"
    Then input box last change should be "Hello {{foo}} xyz"

  Scenario: Disabled input cannot be edited
    Then input box "inputbox-disabled" should be disabled

  Scenario: Placeholder is hidden until focus (showPlaceholderOnFocus)
    Then input box "inputbox-placeholder-focus" placeholder should be ""
    When I focus input box "inputbox-placeholder-focus"
    Then input box "inputbox-placeholder-focus" placeholder should be "Hidden until focus"

  Scenario: Validation error sets aria-invalid and message
    When I focus input box "inputbox-validated-error"
    When I set input box "inputbox-validated-error" value to "abc"
    Then input box "inputbox-validated-error" should have aria-invalid "true"
    Then input box "inputbox-validated-error" message should be "Invalid email format"
    Then input box "inputbox-validated-error" message type should be "error"

  Scenario: Debounced input updates after a delay
    When I set input box "inputbox-debounced" value to "hello"
    Then input box last change should still be "" within 100 ms
    Then input box last change should eventually contain "hello"

