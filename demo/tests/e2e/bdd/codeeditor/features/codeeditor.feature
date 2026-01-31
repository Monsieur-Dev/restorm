Feature: CodeEditor component
  The CodeEditor component wraps Monaco with theme synchronization and custom actions.

  Background:
    Given I open the code editor tab

  Scenario: Debounced onChange updates after a delay
    Then code editor last change should be ""
    When I set code editor value input to "Hello {{foo}} abc"
    When I apply code editor value to "basic"
    Then code editor last change should still be "" within 100 ms
    Then code editor last change should eventually contain " abc"

  Scenario: changeDebounceMs=0 updates immediately
    Then code editor last change should be ""
    When I set code editor value input to "Hello {{foo}} xyz"
    When I apply code editor value to "no-debounce"
    Then code editor last change should eventually contain " xyz"

  Scenario: Go to definition extracts handlebars variable name
    When I place the cursor on the handlebars variable
    When I run go to definition in the demo code editor
    Then code editor go to definition should be "foo"

  Scenario: Theme auto follows document theme
    When I set document theme to "light"
    Then code editor "codeeditor-basic" resolved theme should be "vs"
    When I set document theme to "dark"
    Then code editor "codeeditor-basic" resolved theme should be "vs-dark"

  Scenario: Theme forced ignores document theme changes
    When I set document theme to "dark"
    Then code editor "codeeditor-theme-forced" resolved theme should be "vs"
    When I set document theme to "light"
    Then code editor "codeeditor-theme-forced" resolved theme should be "vs"

