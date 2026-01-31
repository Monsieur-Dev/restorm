Feature: Breadcrumb
  As a user
  I want to interact with the breadcrumb
  So that navigation and rename behaviors stay stable

  Background:
    Given I open the breadcrumb tab

  Scenario: Clicking the first breadcrumb item emits a click event and does not enable editing
    When I click breadcrumb "breadcrumb-main" item index 0
    Then breadcrumb "breadcrumb-main" should have emitted a click event for index 0 and id "main-root"
    And breadcrumb "breadcrumb-main" should not be in editing mode

  Scenario: Clicking the second breadcrumb item emits a click event and does not enable editing
    When I click breadcrumb "breadcrumb-main" item index 1
    Then breadcrumb "breadcrumb-main" should have emitted a click event for index 1 and id "main-section"
    And breadcrumb "breadcrumb-main" should not be in editing mode

  Scenario: Start editing the last breadcrumb item
    When I start editing breadcrumb "breadcrumb-main" last item
    Then breadcrumb "breadcrumb-main" should be in editing mode

  Scenario: Commit rename with Enter
    When I start editing breadcrumb "breadcrumb-main" last item
    And I set breadcrumb "breadcrumb-main" last item to "Renamed"
    And I submit breadcrumb "breadcrumb-main" edition with Enter
    Then the last breadcrumb label in "breadcrumb-main" should be "Renamed"
    And breadcrumb "breadcrumb-main" last change value should be "Renamed"

  Scenario: Commit rename with blur
    When I start editing breadcrumb "breadcrumb-main" last item
    And I set breadcrumb "breadcrumb-main" last item to "Renamed (blur)"
    And I submit breadcrumb "breadcrumb-main" edition with blur
    Then the last breadcrumb label in "breadcrumb-main" should be "Renamed (blur)"
    And breadcrumb "breadcrumb-main" last change value should be "Renamed (blur)"

  Scenario: Cancel rename with Escape
    When I start editing breadcrumb "breadcrumb-main" last item
    And I set breadcrumb "breadcrumb-main" last item to "Should not be committed"
    And I cancel breadcrumb "breadcrumb-main" edition with Escape
    Then breadcrumb "breadcrumb-main" should not be in editing mode
    And the last breadcrumb label in "breadcrumb-main" should be "Leaf"

  Scenario: Shows committed value until parent updates
    When I start editing breadcrumb "breadcrumb-delayed" last item
    And I set breadcrumb "breadcrumb-delayed" last item to "Delayed rename"
    And I submit breadcrumb "breadcrumb-delayed" edition with Enter
    Then the last breadcrumb label in "breadcrumb-delayed" should be "Delayed rename"
    And breadcrumb "breadcrumb-delayed" last change value should be "Delayed rename"

