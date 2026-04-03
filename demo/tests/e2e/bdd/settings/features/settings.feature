Feature: Settings

  Scenario: Open settings modal and switch language
    Given I open the settings e2e tab
    Then modal "settings-modal" should be hidden

    When I click button "settings-e2e-open"
    Then modal "settings-modal" should be visible
    Then settings page "settings-page" should be visible
    Then settings page "settings-page" theme carousel should be visible
    Then scrollable element "settings-page-theme-carousel-scrollable" should be visible
    Then settings page "settings-page" language select box should be visible

    When I open select box "settings-page-language-selectbox"
    When I select option 1 in select box "settings-page-language-selectbox"
    Then settings page "settings-page" language should be "fr"

    When I close modal "settings-modal" with Escape
    Then modal "settings-modal" state should be "closed"

  Scenario: Custom renderer is displayed in settings via gear icon
    Given I am on the theme test page
    When I click button "settings-gear"
    Then modal "settings-modal" should be visible
    Then element "settings-group-demo" should be visible
    Then element "demo-custom-renderer" should be visible

    When I close modal "settings-modal" with Escape
    Then modal "settings-modal" state should be "closed"
