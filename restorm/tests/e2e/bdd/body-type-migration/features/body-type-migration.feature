Feature: Legacy body-type canonicalisation on load
  A .restorm file persisted with the old camelCase body.type spellings
  (`formData` / `xWwwFormUrlEncoded`) must load transparently: the app
  migrates each body to the canonical kebab-case vocabulary
  (`form-data` / `x-www-form-urlencoded`), the request opens in the right
  body mode with its fields intact, and the migration does NOT flag the
  document dirty.

  Scenario: A legacy camelCase collection migrates to kebab-case on open
    Given I open the legacy body-type sample collection
    Then the window should be clean

    When I open the request "Legacy form-data request" in a tab
    Then the body mode should be "form-data"
    And the body fields table should be visible

    When I open the request "Legacy urlencoded request" in a tab
    Then the body mode should be "x-www-form-urlencoded"
    And the body fields table should be visible

    Then the window should be clean
