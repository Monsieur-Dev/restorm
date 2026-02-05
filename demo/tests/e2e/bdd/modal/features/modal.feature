Feature: Modal

  Scenario: Full modal closes with Escape
    Given I open the modal e2e tab
    When I click button "modal-open-full"
    Then modal "modal-e2e" should be visible
    Then modal "modal-e2e" size should be "full"
    Then modal "modal-e2e" state should be "open"

    When I close modal "modal-e2e" with Escape
    Then modal "modal-e2e" should be hidden
    Then modal harness last close should be "escape"

  Scenario: Dialog modal closes with close button
    Given I open the modal e2e tab
    When I click button "modal-open-dialog"
    Then modal "modal-e2e" should be visible
    Then modal "modal-e2e" size should be "dialog"
    Then modal "modal-e2e" state should be "open"

    When I close modal "modal-e2e" with close button
    Then modal "modal-e2e" should be hidden
    Then modal harness last close should be "button"

  Scenario: Full modal closes with header middle click
    Given I open the modal e2e tab
    When I click button "modal-open-full"
    Then modal "modal-e2e" should be visible
    Then modal "modal-e2e" state should be "open"

    When I close modal "modal-e2e" with header middle click
    Then modal "modal-e2e" should be hidden
    Then modal harness last close should be "middle"
