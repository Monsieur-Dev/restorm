Feature: Toggle

  Scenario: Clicking the action toggles checked state
    Given I open the toggle tab
    Then toggle "toggle-basic-unchecked" should be visible
    Then toggle "toggle-basic-unchecked" should be unchecked
    When I click toggle "toggle-basic-unchecked"
    Then toggle "toggle-basic-unchecked" should be checked
    Then toggle change count should be 1
    Then toggle last change should contain "toggle-basic-unchecked"
    Then toggle last change should contain "\"viaKeyboard\":false"

  Scenario: Clicking the label toggles checked state
    Given I open the toggle tab
    Then toggle "toggle-basic-unchecked" should be unchecked
    When I click toggle "toggle-basic-unchecked" label
    Then toggle "toggle-basic-unchecked" should be checked
    Then toggle last change should contain "\"viaKeyboard\":false"

  Scenario: Keyboard toggles checked state and sets viaKeyboard=true
    Given I open the toggle tab
    Then toggle "toggle-basic-unchecked" should be unchecked
    When I press "Space" on toggle "toggle-basic-unchecked"
    Then toggle "toggle-basic-unchecked" should be checked
    Then toggle last change should contain "\"viaKeyboard\":true"

  Scenario: Disabled toggle does not change on click or keyboard
    Given I open the toggle tab
    Then toggle "toggle-disabled" should be visible
    Then toggle "toggle-disabled" should be disabled
    Then toggle change count should be 0
    When I click toggle "toggle-disabled"
    Then toggle change count should be 0
    When I press "Space" on toggle "toggle-disabled"
    Then toggle change count should be 0

  Scenario: The switch appearance draws a keyboard focus ring, the star does not
    Given I open the toggle tab
    Then toggle "toggle-basic-unchecked" should show a keyboard focus ring
    And toggle "toggle-star" should be visible
    And toggle "toggle-star" should NOT show a keyboard focus ring
