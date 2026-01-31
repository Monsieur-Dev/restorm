Feature: CustomWCO component
  The CustomWCO component renders custom window controls on Linux, and a spacer on win32/darwin.

  Background:
    Given I open the custom wco tab

  Scenario: Linux buttons trigger window actions
    Then custom wco "customwco-linux" should be visible
    When I click custom wco "customwco-linux" minimize
    Then custom wco last action should be "minimize"
    When I click custom wco "customwco-linux" maximize
    Then custom wco last action should be "maximize"
    When I click custom wco "customwco-linux" close
    Then custom wco last action should be "close"

  Scenario: Maximize icon toggles between maximize and restore
    Then custom wco "customwco-linux" maximize icon should be "chrome-maximize"
    When I set demo custom wco window state to "maximized"
    Then custom wco "customwco-linux" maximize icon should be "chrome-restore"
    When I set demo custom wco window state to "restored"
    Then custom wco "customwco-linux" maximize icon should be "chrome-maximize"

  Scenario: win32 and darwin render a spacer
    Then custom wco spacer "customwco-win32" should be visible
    Then custom wco spacer "customwco-darwin" should be visible

  Scenario: Other platforms render nothing
    Then custom wco "customwco-other" should be hidden

