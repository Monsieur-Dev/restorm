Feature: SettingsTreeView

  Scenario: Select category and expand nested categories via search
    Given I open the settings tree view e2e tab
    Then settings tree view "settingstreeview-e2e" should be visible
    Then settings tree view "settingstreeview-e2e" category "workspace" should be visible
    Then settings tree view "settingstreeview-e2e" category "general-appearance-theme" should be hidden

    When I select settings tree view "settingstreeview-e2e" category "workspace"
    Then settings tree view "settingstreeview-e2e" selected category should be "workspace"
    Then settings tree view harness selected category should be "workspace"

    When I type "the" in settings tree view search
    Then settings tree view "settingstreeview-e2e" category "general-appearance-theme" should be visible
    Then settings tree view "settingstreeview-e2e" category "general-appearance" expanded should be "true"

    When I select settings tree view "settingstreeview-e2e" category "general-appearance-theme"
    Then settings tree view "settingstreeview-e2e" selected category should be "general-appearance-theme"
    Then settings tree view harness selected category should be "general-appearance-theme"
