Feature: ListViewDropdown

  Scenario: Renders closed by default
    Given I open the list view dropdown e2e tab
    Then list view dropdown "listviewdropdown-e2e" should be visible
    Then list view dropdown "listviewdropdown-e2e" should be closed

  Scenario: Click item updates selection and button text
    Given I open the list view dropdown e2e tab
    When I toggle list view dropdown "listviewdropdown-e2e"
    Then list view dropdown "listviewdropdown-e2e" should be open
    Then list view dropdown "listviewdropdown-e2e" panel should be visible
    Then list view "listviewdropdown-e2e-listview" should be visible
    Then list view dropdown "listviewdropdown-e2e" item "alpha" should be visible
    Then list view dropdown "listviewdropdown-e2e" item "beta" should be visible
    Then list view dropdown "listviewdropdown-e2e" item "gamma" should be visible

    When I click list view "listviewdropdown-e2e-listview" item "beta"
    Then list view dropdown "listviewdropdown-e2e" should be closed
    Then list view dropdown "listviewdropdown-e2e" button text should be "Beta"
    Then list view dropdown "listviewdropdown-e2e" selected ids should be "beta"
    Then list view dropdown harness last clicked should be "beta"
