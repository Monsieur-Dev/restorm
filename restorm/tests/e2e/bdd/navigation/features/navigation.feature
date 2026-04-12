Feature: Navigation back/forward and Ctrl+Tab
  As a user, I want to navigate between tabs using back/forward buttons
  and Ctrl+Tab overlay.

  Scenario: Navigate with back/forward buttons
    Given the file is loaded
    When I open "Swagger Petstore" from the sidebar
    And I open "GraphQL Docker" from the sidebar
    And I open "gRPC Docker" from the sidebar
    Then the active tab title should contain "gRPC Docker"
    When I click the navigation back button
    Then the active tab title should contain "GraphQL Docker"
    When I click the navigation back button
    Then the active tab title should contain "Swagger Petstore"
    When I click the navigation forward button
    Then the active tab title should contain "GraphQL Docker"

  Scenario: Ctrl+Tab cycles between last two tabs
    Given the file is loaded
    When I open "Swagger Petstore" from the sidebar
    And I open "GraphQL Docker" from the sidebar
    And I open "gRPC Docker" from the sidebar
    When I press Ctrl+Tab and release
    Then the active tab title should contain "GraphQL Docker"
    When I press Ctrl+Tab and release
    Then the active tab title should contain "gRPC Docker"

  Scenario: Tab switcher overlay shows items in navigation order
    Given the file is loaded
    When I open "Swagger Petstore" from the sidebar
    And I open "GraphQL Docker" from the sidebar
    And I open "gRPC Docker" from the sidebar
    When I hold Ctrl and press Tab to open the tab switcher
    Then the tab switcher item at index 0 should contain "gRPC Docker"
    And the tab switcher item at index 1 should contain "GraphQL Docker"
    And the tab switcher item at index 2 should contain "Swagger Petstore"
    When I release Ctrl
