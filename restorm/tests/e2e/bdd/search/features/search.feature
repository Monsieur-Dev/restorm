Feature: Search
  As a user, I want to search for requests
  so that I can quickly find what I'm looking for.

  Scenario: Should update results when search query changes
    Given the file is loaded
    When I open the search bar
    And I search for "pet"
    Then I should see search results
    When I hover over the first search result
    Then a tooltip should be visible
    When I search for "user"
    Then I should see search results
    And the first result should contain "user"
    And I search for "SayHello"
    Then I should see search results
    Then the number of results should be 1
    When I close the file
    When I open the search bar
    And I search for "pet"
    Then I should see no search results
    

    