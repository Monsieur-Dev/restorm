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
    # The Cookie jar tool — seeded with example cookies, then captured per
    # locale straight into the website's documentation assets.
    And I seed the cookie jar with example cookies
    And I open the Cookie jar
    And I capture the Cookie jar for every locale to "{locale}/cookies-pot-cookies.png"
    # The account card and the tokens modal — the first captures this harness
    # feeds straight into the website's documentation assets.
    And I capture the account card for every locale to "{locale}/compte-menu-connecte.png"
    And I capture my CLI/CI tokens for every locale to "{locale}/jetons-cli-modale.png"
    # The MCP status-bar popover and the "Add Restorm to your AI assistant" modal —
    # the in-app one-click way to connect an AI, captured scoped to each element.
    And I capture the MCP indicator for every locale to "{locale}/mcp-indicateur-barre-etat.png"
    And I capture the MCP connect modal for every locale to "{locale}/mcp-ajouter-agent-ia.png"
    And I create a custom enumeration "character" with the value "Buffy"
    And I build the scenario "Fight" chaining an input using "character", "Action Move", a log "Character moved", a 1000 ms wait and "Action Fight"
    And I mark the scenario "Fight" as favorite
    Then I capture a screenshot for every locale to "{locale}/scenario-editor.png"
    # Imported-API problem detection: import a deliberately flawed API, open its
    # env-folder "Problems" tab (collapsed list), and frame the capture on it.
    And I import an API with design problems and open its Problems tab
    Then I capture the API problems view for every locale to "{locale}/api-problemes-detectes.png"
