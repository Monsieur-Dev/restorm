Feature: Sash

  Scenario: Vertical drag updates left width
    Given I open the sash tab
    Then vertical sash container "vertical-sash-basic" should be visible
    Then vertical sash container "vertical-sash-basic" left width should be 260
    When I drag vertical sash container "vertical-sash-basic" by 100
    Then vertical sash container "vertical-sash-basic" left width should be 360

  Scenario: Vertical clamps to min
    Given I open the sash tab
    When I drag vertical sash container "vertical-sash-basic" by -1000
    Then vertical sash container "vertical-sash-basic" sash state should be "atMinimum"
    Then vertical sash container "vertical-sash-basic" left width should be 150

  Scenario: Vertical clamps to max
    Given I open the sash tab
    When I drag vertical sash container "vertical-sash-basic" by 1000
    Then vertical sash container "vertical-sash-basic" sash state should be "atMaximum"
    Then vertical sash container "vertical-sash-basic" left width should be 560

  Scenario: Horizontal drag updates top height
    Given I open the sash tab
    Then horizontal sash container "horizontal-sash-basic" should be visible
    Then horizontal sash container "horizontal-sash-basic" top height should be 200
    When I drag horizontal sash container "horizontal-sash-basic" by 30
    Then horizontal sash container "horizontal-sash-basic" top height should be 230

  Scenario: Double click reset restores initial size
    Given I open the sash tab
    When I drag vertical sash container "vertical-sash-with-reset" by 100
    Then vertical sash container "vertical-sash-with-reset" left width should be 360
    When I double click sash "vertical-sash-with-reset-sash"
    Then vertical sash container "vertical-sash-with-reset" left width should be 260

  Scenario: storageKey persists after reload
    Given I open the sash tab
    When I drag vertical sash container "vertical-sash-with-storage" by 100
    Then vertical sash container "vertical-sash-with-storage" left width should be 360
    When I reload the page
    Then vertical sash container "vertical-sash-with-storage" left width should be 360

