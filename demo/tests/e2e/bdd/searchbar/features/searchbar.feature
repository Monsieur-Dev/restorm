Feature: SearchBar

  Scenario: Renders closed by default
    Given I open the search bar e2e tab
    Then search bar "searchbar" should be visible
    Then search bar "searchbar" should be closed

  Scenario: Opens, searches, shows tooltip and click result
    Given I open the search bar e2e tab
    When I open search bar "searchbar"
    Then search bar "searchbar" should be open
    Then input box "searchbar-inputbox" should be visible

    When I type in search bar "searchbar" query letter by letter "item"
    Then search bar "searchbar" results should be visible
    Then search bar "searchbar" results count should be 3
    Then scrollable element "searchbar-scrollable" should be visible

    When I hover search bar "searchbar" result "get-items"
    Then tooltip "searchbar-tooltip" should be visible
    Then markdown viewer "searchbar-tooltip-markdown" should be visible
    Then markdown viewer "searchbar-tooltip-markdown" should contain text "Returns a list of items."

    When I click search bar "searchbar" result "post-items"
    Then search bar harness last clicked should be "post-items"

