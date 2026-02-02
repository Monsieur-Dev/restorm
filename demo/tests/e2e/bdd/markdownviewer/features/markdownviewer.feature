Feature: MarkdownViewer

  Scenario: Renders markdown and GFM content
    Given I open the markdown viewer tab
    Then markdown viewer "markdownviewer-basic" should be visible
    Then markdown viewer "markdownviewer-basic" should contain text "MarkdownViewer"
    Then markdown viewer "markdownviewer-basic" allow mermaid should be "true"

  Scenario: Copy button toggles copied state
    Given I open the markdown viewer tab
    When I click markdown viewer "markdownviewer-basic" code block 0 copy
    Then markdown viewer "markdownviewer-basic" code block 0 copy should be copied

  Scenario: Mermaid renders when enabled
    Given I open the markdown viewer tab
    Then markdown viewer "markdownviewer-basic" mermaid block 0 should be rendered

  Scenario: Mermaid is disabled when allowMermaid=false
    Given I open the markdown viewer tab
    Then markdown viewer "markdownviewer-no-mermaid" allow mermaid should be "false"
    Then markdown viewer "markdownviewer-no-mermaid" should contain text "flowchart"

  Scenario: Clicking an http link opens a popup
    Given I open the markdown viewer tab
    When I click markdown viewer "markdownviewer-basic" link 0
    Then a popup should open with url "https://example.com/"

