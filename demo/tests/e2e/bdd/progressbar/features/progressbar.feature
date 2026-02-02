Feature: ProgressBar

  Scenario: Discrete 50% exposes aria-valuenow and width percent
    Given I open the progress bar tab
    Then progress bar "progressbar-discrete-50" should be visible
    Then progress bar "progressbar-discrete-50" data-mode should be "discrete"
    Then progress bar "progressbar-discrete-50" aria-valuenow should be 50
    Then progress bar "progressbar-discrete-50" width percent should be 50

  Scenario: Infinite has fixed width percent
    Given I open the progress bar tab
    Then progress bar "progressbar-infinite" should be visible
    Then progress bar "progressbar-infinite" data-mode should be "infinite"
    Then progress bar "progressbar-infinite" width percent should be 2

  Scenario: Infinite becomes long running after ~10s
    Given I open the progress bar tab
    Then progress bar "progressbar-infinite" should become long running

  Scenario: Done from discrete becomes inactive and calls onComplete
    Given I open the progress bar tab
    When I click progress bar button "progressbar-discrete-set-done"
    Then progress bar "progressbar-done-from-discrete" data-mode should be "done"
    Then progress bar "progressbar-done-from-discrete" should be inactive
    Then progress bar onComplete count should be 1
    Then progress bar last complete should be "progressbar-done-from-discrete"

  Scenario: Done from infinite becomes inactive and calls onComplete
    Given I open the progress bar tab
    When I click progress bar button "progressbar-infinite-set-done"
    Then progress bar "progressbar-done-from-infinite" data-mode should be "done"
    Then progress bar "progressbar-done-from-infinite" should be inactive
    Then progress bar onComplete count should be 1
    Then progress bar last complete should be "progressbar-done-from-infinite"

