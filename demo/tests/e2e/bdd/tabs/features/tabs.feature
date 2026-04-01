Feature: Tabs

  Background:
    Given I open the tabs test tab

  Scenario: Should display all tabs
    Then the tabs "tabs-test" should have 3 tabs

  Scenario: Should switch active tab on click
    When I click on tab "tab-2" in "tabs-test"
    Then the active tab in "tabs-test" should be "tab-2"

  Scenario: Should show first tab as active by default
    Then the active tab in "tabs-test" should be "tab-1"
