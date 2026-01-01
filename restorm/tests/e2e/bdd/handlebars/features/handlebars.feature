Feature: Handlebars Transformations
  As a user, I want to see Handlebars variables resolved in URL tooltips
  so that I can verify the actual URL that will be used.

  Scenario: Should resolve and update path params in URL tooltip
    Given the Test API folder is expanded
    When I click on the "Get User" request
    Then the URL tooltip should contain "/users/12345"
    When I change the path param "userId" from "12345" to "99999"
    Then the URL tooltip should contain "https://api.example.com"
    And the URL tooltip should contain "/users/99999"
    And the URL tooltip should not contain "/users/12345"

