Feature: Titlebar

  Scenario: Renders title mode by default
    Given I open the titlebar e2e tab
    Then titlebar "titlebar-e2e" should be visible
    Then titlebar "titlebar-e2e" showSearchBar should be "false"
    Then titlebar "titlebar-e2e" title should be "Demo"

  Scenario: Search mode uses internal SearchBar and CustomWCO
    Given I open the titlebar e2e tab
    When I set titlebar show search bar to "true"
    Then titlebar "titlebar-e2e" showSearchBar should be "true"
    Then search bar "titlebar-e2e-searchbar" should be visible

    When I open search bar "titlebar-e2e-searchbar"
    When I type in search bar "titlebar-e2e-searchbar" query "item"
    Then search bar "titlebar-e2e-searchbar" results count should be 2

    When I click search bar "titlebar-e2e-searchbar" result "get-items"
    Then titlebar harness last clicked should be "get-items"

    Then custom wco "titlebar-e2e-customwco" should be visible

