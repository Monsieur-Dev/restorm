Feature: Documentation screenshots

  Capture localized, reproducible screenshots of the app for the website
  documentation. Not a regression suite: the project only exists when
  deliberately included (see the doc-shots gate in playwright.config.ts),
  and it signs in with the curated demo account against a real backend.

  Scenario: Capture the welcome, request and scenario views in every locale
    Given the app is running in documentation-capture mode
    And I am signed in with the demo account
    When I capture a screenshot for every locale to "{locale}/welcome-home.png"
    And I create a new project and import the ArtifactsMMO OpenAPI spec from its URL
    And I open the imported request "Action Move" from folder "My characters"
    And I capture a screenshot for every locale to "{locale}/request-editor.png"
    And I create a custom enumeration "character" with the value "Buffy"
    And I build the scenario "Fight" chaining an input using "character", "Action Move", a log "Character moved", a 1000 ms wait and "Action Fight"
    And I mark the scenario "Fight" as favorite
    Then I capture a screenshot for every locale to "{locale}/scenario-editor.png"
