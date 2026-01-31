Feature: Button
  As a user
  I want to interact with buttons
  So that actions and UI behavior stay stable

  Background:
    Given I open the button tab

  Scenario: Button click increments count
    When I click button "button-basic"
    Then button "button-basic" click count should be 1

  Scenario: Disabled button does not increment count
    When I try to click button "button-disabled"
    Then button "button-disabled" click count should be 0
    And button "button-disabled" should be disabled

  Scenario: Keyboard Enter triggers click
    When I press "Enter" on button "button-keyboard"
    Then button "button-keyboard" click count should be 1

  Scenario: Keyboard Space triggers click
    When I press "Space" on button "button-keyboard"
    Then button "button-keyboard" click count should be 1

  Scenario: Escape blurs the button
    When I press "Escape" on button "button-keyboard"
    Then button "button-keyboard" should not be focused

  Scenario: Icon prop renders codicon
    Then button "button-icon-prop" should contain codicon "save"

  Scenario: Inline icon parsing renders codicon
    Then button "button-icon-inline" should contain codicon "play"

  Scenario: ButtonWithDescription click increments count and renders icon
    When I click button "button-with-description"
    Then button "button-with-description" click count should be 1
    And button "button-with-description" should contain codicon "rocket"

  Scenario: ButtonWithIcon click increments count and renders icon
    When I click button "button-with-icon"
    Then button "button-with-icon" click count should be 1
    And button "button-with-icon" should contain codicon "play"

  Scenario: ButtonWithDropdown primary click increments count
    When I click dropdown "button-dropdown" primary action
    Then dropdown "button-dropdown" primary click count should be 1

  Scenario: ButtonWithDropdown open and click action closes menu
    When I open dropdown "button-dropdown"
    Then dropdown "button-dropdown" should be open
    When I click dropdown "button-dropdown" action index 0
    Then dropdown "button-dropdown" should be closed
    And dropdown "button-dropdown" last action label should be "Action A"

  Scenario: ButtonWithDropdown click outside closes menu
    When I open dropdown "button-dropdown"
    When I click outside
    Then dropdown "button-dropdown" should be closed

  Scenario: Disabled dropdown cannot open
    When I open dropdown "button-dropdown-disabled"
    Then dropdown "button-dropdown-disabled" should be closed

