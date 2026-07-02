Feature: API Blueprint import — resource groups, requests, and auto-detection
  Covers the import half of the API Blueprint (.apib) format against the
  committed "Polls" fixture: importing a file builds the resource-group
  folder, re-importing creates a separate copy (there is no merge-on-refresh
  for a plain file import), and the `FORMAT: 1A` content sniff alone — not
  just the `.apib` extension — is enough for auto-detection.

  Scenario: Import a .apib file builds the resource-group folder
    Given a new single-file YAML collection for API Blueprint import
    When I import the API Blueprint fixture file "polls.apib"
    Then the sidebar should show the imported folder "Question"

  Scenario: Re-import creates a separate copy
    Given a new single-file YAML collection for API Blueprint import
    When I import the API Blueprint fixture file "polls.apib"
    And I import the API Blueprint fixture file "polls.apib"
    Then exactly 2 folders named "Question" should be in the sidebar

  Scenario: Auto-detection recognises the FORMAT: 1A header without the .apib extension
    Given a new single-file YAML collection for API Blueprint import
    When I import the API Blueprint fixture content saved without the .apib extension
    Then the sidebar should show the imported folder "Question"
