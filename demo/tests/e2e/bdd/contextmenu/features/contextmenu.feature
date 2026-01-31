Feature: ContextMenu component
  The ContextMenu component displays a right-click menu at screen coordinates.

  Background:
    Given I open the context menu tab

  Scenario: Open the context menu from the target
    When I open the demo context menu
    Then context menu "contextmenu-main" should be visible
    And context menu "contextmenu-main" should have a separator

  Scenario: Clicking an enabled item triggers action and closes
    When I open the demo context menu
    And I click context menu "contextmenu-main" item "Action"
    Then context menu "contextmenu-main" should be hidden
    And context menu last action should be "action"

  Scenario: Clicking a disabled item does not trigger action
    When I open the demo context menu
    Then context menu "contextmenu-main" item "Disabled" should be disabled
    When I click context menu "contextmenu-main" item "Disabled"
    Then context menu last action should not be "disabled"

  Scenario: Checked item is marked as checked
    When I open the demo context menu
    Then context menu "contextmenu-main" item "Checked" should be checked

  Scenario: Icon item renders codicon
    When I open the demo context menu
    Then context menu "contextmenu-main" item "With Icon" should have icon "rocket"

  Scenario: Close on outside click
    When I open the demo context menu
    And I click outside the demo context menu
    Then context menu "contextmenu-main" should be hidden

  Scenario: Open submenu via keyboard
    When I open the demo context menu
    And I open context menu "contextmenu-main" submenu "Submenu" with keyboard
    Then context menu "contextmenu-main" submenu "Submenu" should be open
    When I click context menu "contextmenu-main" submenu item "Submenu" -> "Sub Action"
    Then context menu last action should be "subAction"

  Scenario: Open submenu via hover
    When I open the demo context menu
    And I open context menu "contextmenu-main" submenu "Submenu" with hover
    Then context menu "contextmenu-main" submenu "Submenu" should be open

