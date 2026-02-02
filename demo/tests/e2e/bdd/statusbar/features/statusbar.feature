Feature: Statusbar

  Scenario: Render statusbar and count elements
    Given I open the statusbar e2e tab
    Then statusbar "statusbar-basic" should be visible
    Then statusbar "statusbar-basic" should have 4 elements

  Scenario: Element states are exposed
    Given I open the statusbar e2e tab
    Then statusbar element "statusbar-ready-element" should have warning "false"
    Then statusbar element "statusbar-ready-element" should have error "false"
    Then statusbar element "statusbar-ready-element" should be clickable "false"
    Then statusbar element "statusbar-warning-element" should have warning "true"
    Then statusbar element "statusbar-error-element" should have error "true"
    Then statusbar element "statusbar-error-element" should be clickable "true"

  Scenario: Hover shows tooltip and moving away hides it
    Given I open the statusbar e2e tab
    When I hover statusbar element "statusbar-warning-element"
    Then statusbar element "statusbar-warning-element" tooltip should be visible
    When I move mouse away from statusbar element "statusbar-warning-element"
    Then statusbar element "statusbar-warning-element" tooltip should be hidden

  Scenario: Click triggers action
    Given I open the statusbar e2e tab
    Then statusbar action count should be 0
    When I click statusbar element "statusbar-error-element"
    Then statusbar action count should be 1
    Then statusbar last action should be "error-click"

  Scenario: Keyboard activation triggers action
    Given I open the statusbar e2e tab
    Then statusbar action count should be 0
    When I press "Enter" on statusbar element "statusbar-clickable-element"
    Then statusbar action count should be 1
    Then statusbar last action should be "clickable-click"

