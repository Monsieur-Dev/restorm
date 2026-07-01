Feature: API Blueprint import — resource groups, requests, and auto-detection
  Covers the import half of the API Blueprint (.apib) format against the
  committed "Polls" fixture: importing a file builds the resource-group
  folder, re-importing is idempotent, and pasting the raw document (no file
  extension) is auto-detected via the `FORMAT: 1A` content sniff.

  Scenario: Import a .apib file builds the resource-group folder
    Given a new single-file YAML collection for API Blueprint import
    When I import the API Blueprint fixture file "polls.apib"
    Then the sidebar should show the imported folder "Question"

  Scenario: Re-import is idempotent
    Given a new single-file YAML collection for API Blueprint import
    When I import the API Blueprint fixture file "polls.apib"
    And I import the API Blueprint fixture file "polls.apib"
    Then exactly 1 folder named "Question" should be in the sidebar

  Scenario: Pasting raw API Blueprint content is auto-detected
    Given a new single-file YAML collection for API Blueprint import
    When I paste the API Blueprint fixture content into the import source
    Then the sidebar should show the imported folder "Question"
