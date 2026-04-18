Feature: Toaster

  Background:
    Given I open the toaster tab

  Scenario: Push a toast from the form
    When I fill toaster title "Hello world"
    When I fill toaster body "A first notification"
    When I click "toaster-push"
    Then toaster "demo-toaster" should be visible
    Then toaster "demo-toaster" should contain toast "Hello world"
    Then toaster "demo-toaster" should have 1 toasts

  Scenario: Dismiss a toast via its close button
    When I fill toaster title "Goodbye"
    When I fill toaster body "dismiss me"
    When I click "toaster-push"
    Then toaster "demo-toaster" should contain toast "Goodbye"
    When I dismiss toast "Goodbye" of toaster "demo-toaster"
    Then toaster "demo-toaster" should not contain toast "Goodbye"

  Scenario: Statusbar bell toggles the framed mode
    When I click "statusbar-toaster-bell"
    Then toaster "demo-toaster" should show the frame
    When I click "statusbar-toaster-bell"
    Then toaster "demo-toaster" should hide the frame

  Scenario: Do-not-disturb archives subsequent toasts (visible only in frame)
    When I click "statusbar-toaster-bell"
    Then toaster "demo-toaster" should show the frame
    When I click do-not-disturb button of toaster "demo-toaster"
    Then toaster "demo-toaster" should be in do-not-disturb mode
    When I click "statusbar-toaster-bell"
    Then toaster "demo-toaster" should hide the frame
    When I fill toaster title "Muted"
    When I fill toaster body "archived under dnd"
    When I click "toaster-push"
    Then toaster "demo-toaster" should have 0 toasts
    When I click "statusbar-toaster-bell"
    Then toaster "demo-toaster" should show the frame
    Then toaster "demo-toaster" should contain toast "Muted"
    Then toaster "demo-toaster" should have 1 toasts

  Scenario: Clear-all empties the stack
    When I click "statusbar-toaster-bell"
    When I click "toaster-preset-burst"
    Then toaster "demo-toaster" should have 5 toasts
    When I click clear-all button of toaster "demo-toaster"
    Then toaster "demo-toaster" should have 0 toasts
