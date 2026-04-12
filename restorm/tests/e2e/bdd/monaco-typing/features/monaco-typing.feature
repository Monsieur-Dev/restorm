Feature: Monaco URL field typing perturbation
  Reproduces the bug where typing characters at the start of a URL field
  causes the cursor to jump to the end after a few keystrokes (because
  IPC echoes from the backend re-render the parent and reset Monaco).

  # The bug reliably triggers when each keystroke is spaced ~200ms (matches the
  # CodeEditor internal debounce). At that cadence, IPC echoes from the previous
  # keystroke arrive between two keystrokes, re-render the parent, and Monaco
  # resets its content because the value prop is still stale.
  Scenario: Typing at the start of the URL with delay matching the CodeEditor debounce
    Given the Test API folder is expanded
    When I click on the "Get User" request
    And I focus the URL field at the start
    And I type "aaaaaaaaaaaaaaa" character by character with delay 200 ms
    Then the URL field should start with "aaaaaaaaaaaaaaa"

  Scenario: Typing in the body editor with delay matching the CodeEditor debounce
    Given the Test API folder is expanded
    When I click on the "Get User" request
    And I focus the body editor at the start
    And I type "bbbbbbbbbbbbbbb" character by character with delay 200 ms
    Then the body editor should start with "bbbbbbbbbbbbbbb"

  # Simulates a key being held down — no delay between keystrokes. Even faster than the
  # debounce window. The perturbation can still happen because any external render that
  # lands in between two keystrokes snapshots a stale value prop.
  Scenario: Typing at the start of the URL with no delay (key held down)
    Given the Test API folder is expanded
    When I click on the "Get User" request
    And I focus the URL field at the start
    And I type "aaaaaaaaaaaaaaa" character by character with delay 0 ms
    Then the URL field should start with "aaaaaaaaaaaaaaa"

  Scenario: Typing in the body editor with no delay (key held down)
    Given the Test API folder is expanded
    When I click on the "Get User" request
    And I focus the body editor at the start
    And I type "bbbbbbbbbbbbbbb" character by character with delay 0 ms
    Then the body editor should start with "bbbbbbbbbbbbbbb"

  # Covers another protocol (GraphQL uses the same RestormVariableInputBox for URL and
  # CodeEditor for query/variables, so the fix should apply identically).
  Scenario: Typing in a GraphQL URL field with delay matching the CodeEditor debounce
    Given the Test API folder is expanded
    When I click on the "Get Users GQL" request
    And I focus the URL field at the start
    And I type "ccccccccccccccc" character by character with delay 200 ms
    Then the URL field should start with "ccccccccccccccc"

  Scenario: Typing in a GraphQL query editor with delay matching the CodeEditor debounce
    Given the Test API folder is expanded
    When I click on the "Get Users GQL" request
    And I focus the GraphQL query editor at the start
    And I type "ddddddddddddddd" character by character with delay 200 ms
    Then the GraphQL query editor should start with "ddddddddddddddd"

  # Covers a folder tab (environment folder) where variable values are Monaco editors
  # through RestormVariableInputBox inside RestormKeyValueTable.
  Scenario: Typing in an environment-folder variable value with delay matching the CodeEditor debounce
    When I click on the "Test API" folder
    And I focus the first environment variable value field
    And I type "eeeeeeeeeeeeeee" character by character with delay 200 ms
    Then the first environment variable value should start with "eeeeeeeeeeeeeee"
