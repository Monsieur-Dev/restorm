Feature: SplitView

  Scenario: Render exposes stable test hooks
    Given I open the split view e2e tab
    Then split view "splitview" should be visible
    Then split view "splitview" pane count should be 3
    Then split view "splitview" collapsed state should be "false|false|false"
    Then split view "splitview" sizes should sum to 100

  Scenario: Toggle collapse updates collapsed state
    Given I open the split view e2e tab
    When I toggle split view "splitview" pane "green"
    Then split view "splitview" collapsed state should be "false|true|false"
    When I toggle split view "splitview" pane "green"
    Then split view "splitview" collapsed state should be "false|false|false"

  Scenario: Dragging a sash updates sizes
    Given I open the split view e2e tab
    Then sash "splitview-sash-0" should be visible
    Then split view "splitview" sizes should be "50|25|25"
    When I drag sash "splitview-sash-0" by x 0 y 80
    Then split view "splitview" sizes should sum to 100

