Feature: Tooltip

  Scenario: Show and hide tooltip
    Given I open the tooltip tab
    Then tooltip "tooltip-basic" should be hidden
    When I click "tooltip-toggle-show"
    Then tooltip "tooltip-basic" should be visible
    When I click "tooltip-toggle-show"
    Then tooltip "tooltip-basic" should be hidden

  Scenario: Placement auto picks below for top target and above for bottom target
    Given I open the tooltip tab
    When I set tooltip placement to "auto"
    When I click "tooltip-toggle-show"
    Then tooltip "tooltip-basic" data-placement should be "below"
    Then tooltip "tooltip-basic" should be below "tooltip-target-a"
    Then tooltip "tooltip-basic" beak should point to "tooltip-target-a" horizontally
    When I click "tooltip-switch-target"
    Then tooltip active target should be "B"
    When I click "tooltip-bump-reposition-key"
    Then tooltip "tooltip-basic" data-placement should be "above"
    Then tooltip "tooltip-basic" should be above "tooltip-target-b"
    Then tooltip "tooltip-basic" beak should point to "tooltip-target-b" horizontally

  Scenario: Side right positions tooltip on the right
    Given I open the tooltip tab
    When I set tooltip side to "right"
    When I click "tooltip-toggle-show"
    Then tooltip "tooltip-basic" data-side should be "right"
    Then tooltip "tooltip-basic" should be right of "tooltip-target-a"
    Then tooltip "tooltip-basic" beak should point to "tooltip-target-a" vertically
    Then tooltip "tooltip-basic" beak left percent should be 0

  Scenario: Side left positions tooltip on the left
    Given I open the tooltip tab
    When I set tooltip side to "left"
    When I click "tooltip-toggle-show"
    Then tooltip "tooltip-basic" data-side should be "left"
    Then tooltip "tooltip-basic" should be left of "tooltip-target-a"
    Then tooltip "tooltip-basic" beak should point to "tooltip-target-a" vertically
    Then tooltip "tooltip-basic" beak left percent should be 100

  Scenario: fixedTop forces vertical position
    Given I open the tooltip tab
    When I enable tooltip fixedTop with value 120
    When I set tooltip side to "right"
    When I click "tooltip-toggle-show"
    Then tooltip "tooltip-basic" data-top should be 120
