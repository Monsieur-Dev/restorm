Feature: MarkdownEditor

  Scenario: Shows initial value
    Given I open the markdown editor tab
    Then markdown editor "markdowneditor-basic" should be visible
    Then markdown editor "markdowneditor-basic" should contain text "My doc"

  Scenario: Typing triggers onChange (letter by letter)
    Given I open the markdown editor tab
    When I focus markdown editor "markdowneditor-basic"
    When I type in markdown editor "markdowneditor-basic" "Hello"
    Then markdown editor last change should contain "Hello"

