Feature: Search
  As a user, I want to search for requests
  so that I can quickly find what I'm looking for.

  Scenario: Should find request in search and open tab on click
    Given the file is loaded
    When I open the search bar
    And I search for "Find pet"
    Then I should see search results
    And the first result should contain "pet"
    When I click on the first search result
    Then a tab containing "find pet" should be open

  Scenario: Should show tooltip on search result hover
    Given the file is loaded
    When I open the search bar
    And I search for "store"
    Then I should see search results
    When I hover over the first search result
    Then a tooltip should be visible

  Scenario: Should update results when search query changes
    Given the file is loaded
    When I open the search bar
    And I search for "pet"
    Then I should see search results
    When I search for "user"
    Then I should see search results
    And the first result should contain "user"

