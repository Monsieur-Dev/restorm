Feature: HAR (HTTP Archive) import — auto-detection + request tree
  Importing a browser devtools network capture (.har) turns every captured
  call into a replayable request, grouped under the page it was captured
  from — no manual "pick a format" step, the importer sniffs `log.version`.

  Scenario: Auto-detecting and importing a HAR export builds the request tree
    Given a new single-file YAML collection for HAR import
    When I import the HAR fixture file "petstore.har"
    Then the sidebar should show the imported folder "https://api.petstore.example/"
    And the sidebar should show a child of "https://api.petstore.example/"

  Scenario: Re-importing the same HAR file adds a second, independent snapshot
    # HAR has no stable "source URL" to refresh from (it's a one-off browser
    # capture, like a curl/PowerShell paste) — v1 deliberately skips the
    # idempotent merge pipeline and imports every entry fresh each time.
    Given a new single-file YAML collection for HAR import
    When I import the HAR fixture file "petstore.har"
    And I import the HAR fixture file "petstore.har"
    Then exactly 2 folders named "https://api.petstore.example/" should be in the sidebar

  Scenario: Importing a HAR file seeds response history for the requests it captured
    # A HAR is a RECORDING of request/response pairs, not just request
    # definitions — the point of importing one is seeing what the capture
    # already showed, without re-running every request first. This is the
    # human "File → Import" path (real modal, real IPC, real preload
    # binding): the renderer regenerates every item's id before the tree
    # reaches main, so history must be seeded with the FINAL id, not the
    # parser's original one.
    Given a new single-file YAML collection for HAR import
    When I import the HAR fixture file "petstore.har"
    Then the imported request "GET /api/pets" should have response history
