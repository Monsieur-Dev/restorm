Feature: Dirty-state propagation across nested units
  After importing a Petstore spec the app auto-saves, so everything starts
  clean. Each edit flips the right combination of per-unit dirty dots and
  the global window title. Per-unit Ctrl+S clears only the active unit;
  Ctrl+Shift+S clears every unit.

  Scenario: Dirty-state in single-file mode
    Given a new single-file YAML collection named "dirty-collection"
    Then the window should be clean

    When I import the Petstore sample
    Then the window should be clean

    When I open the env folder "Swagger Petstore" in a tab
    And I open the folder "pet" in a tab
    And I open the request "Find pet by ID" in a tab

    When I activate the tab "Swagger Petstore"
    And I type "some note" in the notes editor
    Then the window should be dirty
    And the tab "Swagger Petstore" should be dirty
    And the tab "pet" should be clean
    And the tab "Find pet by ID" should be clean

    When I clear the notes editor
    Then the window should be clean
    And the tab "Swagger Petstore" should be clean
    And the tab "pet" should be clean
    And the tab "Find pet by ID" should be clean

    When I edit the first env folder variable value to "edited-value"
    Then the window should be dirty
    And the tab "Swagger Petstore" should be dirty
    And the tab "pet" should be clean
    And the tab "Find pet by ID" should be clean

    When I save with Ctrl+S
    Then the window should be clean
    And the tab "Swagger Petstore" should be clean
    And the tab "pet" should be clean
    And the tab "Find pet by ID" should be clean

    When I type "more notes" in the notes editor
    And I activate the tab "pet"
    And I type "folder notes" in the notes editor
    Then the window should be dirty
    And the tab "Swagger Petstore" should be dirty
    And the tab "pet" should be dirty
    And the tab "Find pet by ID" should be clean

    When I save with Ctrl+S
    Then the window should be dirty
    And the tab "Swagger Petstore" should be dirty
    And the tab "pet" should be clean
    And the tab "Find pet by ID" should be clean

    When I save all with Ctrl+Shift+S
    Then the window should be clean
    And the tab "Swagger Petstore" should be clean
    And the tab "pet" should be clean
    And the tab "Find pet by ID" should be clean

    # ── Per-unit Ctrl+S with three tabs dirty at the same time ────────
    # Modify all three open tabs, then save each in turn. Ctrl+S on a
    # tab must only clear that tab's unit; every other dirty tab stays
    # dirty until its own Ctrl+S (or a Ctrl+Shift+S save-all).
    When I activate the tab "Swagger Petstore"
    And I type "env-note-a" in the notes editor
    And I activate the tab "pet"
    And I type "folder-note-a" in the notes editor
    And I activate the tab "Find pet by ID"
    And I type "request-note-a" in the notes editor
    Then the window should be dirty
    And the tab "Swagger Petstore" should be dirty
    And the tab "pet" should be dirty
    And the tab "Find pet by ID" should be dirty

    When I activate the tab "Swagger Petstore"
    And I save with Ctrl+S
    Then the window should be dirty
    And the tab "Swagger Petstore" should be clean
    And the tab "pet" should be dirty
    And the tab "Find pet by ID" should be dirty

    When I type "env-note-b" in the notes editor
    Then the tab "Swagger Petstore" should be dirty
    When I activate the tab "pet"
    And I save with Ctrl+S
    Then the window should be dirty
    And the tab "Swagger Petstore" should be dirty
    And the tab "pet" should be clean
    And the tab "Find pet by ID" should be dirty

    When I type "folder-note-b" in the notes editor
    Then the tab "pet" should be dirty
    When I activate the tab "Find pet by ID"
    And I save with Ctrl+S
    Then the window should be dirty
    And the tab "Swagger Petstore" should be dirty
    And the tab "pet" should be dirty
    And the tab "Find pet by ID" should be clean

    When I save all with Ctrl+Shift+S
    Then the window should be clean
    And the tab "Swagger Petstore" should be clean
    And the tab "pet" should be clean
    And the tab "Find pet by ID" should be clean

    When I rename the folder tab "pet" to "pet-renamed"
    Then the window should be dirty
    And the tab "Swagger Petstore" should be clean
    And the tab "pet-renamed" should be dirty
    And the tab "Find pet by ID" should be clean

    When I activate the tab "Find pet by ID"
    And I set the HTTP request URL to "https://example.test/pet/1"
    Then the window should be dirty
    And the tab "Swagger Petstore" should be clean
    And the tab "pet-renamed" should be dirty
    And the tab "Find pet by ID" should be dirty

    When I save with Ctrl+S
    Then the window should be dirty
    And the tab "Swagger Petstore" should be clean
    And the tab "pet-renamed" should be dirty
    And the tab "Find pet by ID" should be clean

    When I type "request note" in the notes editor
    Then the window should be dirty
    And the tab "Swagger Petstore" should be clean
    And the tab "pet-renamed" should be dirty
    And the tab "Find pet by ID" should be dirty

    When I clear the notes editor
    And I save with Ctrl+S
    Then the window should be dirty
    And the tab "Swagger Petstore" should be clean
    And the tab "pet-renamed" should be dirty
    And the tab "Find pet by ID" should be clean

    When I save all with Ctrl+Shift+S
    Then the window should be clean
    And the tab "Swagger Petstore" should be clean
    And the tab "pet-renamed" should be clean
    And the tab "Find pet by ID" should be clean

  # char-level URL whitespace round-trip on a freshly-opened
  # file. Closes the freshly-imported single-file collection, reopens
  # via the welcome screen (no in-session save between open and edit),
  # then exercises a one-character append + backspace at the end of an
  # HTTP request URL. The space MUST flip the window dirty (registry
  # picks up the proxy event after the upsert debounce); the backspace
  # MUST flip it clean (the in-memory tree is byte-identical to the
  # on-disk reference). Without the fix, the dirty flag sticks until
  # an explicit Ctrl+S re-hydrates the reference.
  Scenario: URL whitespace round-trip on freshly-opened file
    Given a new single-file YAML collection named "oyo267-url-probe"
    When I import the Petstore sample
    And I close the current file
    And I reopen the welcome recent file "oyo267-url-probe.restorm"
    And I open the env folder "Swagger Petstore" in a tab
    And I open the folder "pet" in a tab
    And I open the request "Find pet by ID" in a tab
    And I activate the tab "Find pet by ID"
    And I append a space to the URL
    Then the window should be dirty
    When I press backspace in the URL
    Then the window should be clean

  # same regression on the request *notes* editor (not just
  # URL). Verifies the hydrate fix covers every field on a freshly-
  # opened file, not just the one the user happened to repro on.
  Scenario: notes round-trip on freshly-opened file
    Given a new single-file YAML collection named "oyo267-notes-probe"
    When I import the Petstore sample
    And I close the current file
    And I reopen the welcome recent file "oyo267-notes-probe.restorm"
    And I open the env folder "Swagger Petstore" in a tab
    And I open the folder "pet" in a tab
    And I open the request "Find pet by ID" in a tab
    And I activate the tab "Find pet by ID"
    And I type "x" in the notes editor
    Then the window should be dirty
    When I clear the notes editor
    Then the window should be clean

  # body round-trip on a request that started with no body.
  # Reproduces the user's "ne marche que pour l'URL" feedback: a GET
  # request imported from Swagger has no body, so the first edit
  # cycle goes from `body: undefined` (own property dropped by
  # JSON.stringify) → `body: {type:'text', content:'x'}` → on revert,
  # the local body state is `''` so the parent useEffect assigns
  # `body: {type:'text', content:''}` rather than restoring
  # `undefined`. Reference and draft now disagree on the body key
  # alone. The empty-string strip in canonicalJson collapses the
  # nested `content:''` but the wrapping `{type:'text'}` discriminator
  # still differs from "no body". This scenario locks in whichever
  # fix lands.
  Scenario: body round-trip on freshly-opened file (no-body baseline)
    Given a new single-file YAML collection named "oyo267-body-probe"
    When I import the Petstore sample
    And I close the current file
    And I reopen the welcome recent file "oyo267-body-probe.restorm"
    And I open the env folder "Swagger Petstore" in a tab
    And I open the folder "pet" in a tab
    And I open the request "Find pet by ID" in a tab
    And I activate the tab "Find pet by ID"
    And I append a space to the body
    Then the window should be dirty
    When I press backspace in the body
    Then the window should be clean

  # First-edit-cycle bug on a KV text input. Imported petstore env
  # variables include `baseUrl` (string). Typing a character then
  # backspacing must clear the dirty flag — same shape as the body
  # case (structured wrapper with an empty inner content vs the
  # original non-empty value).
  Scenario: KV text variable round-trip on freshly-opened file
    Given a new single-file YAML collection named "oyo267-kv-probe"
    When I import the Petstore sample
    And I close the current file
    And I reopen the welcome recent file "oyo267-kv-probe.restorm"
    And I open the env folder "Swagger Petstore" in a tab
    And I activate the tab "Swagger Petstore"
    And I append a space to the first env folder variable value
    Then the window should be dirty
    When I press backspace in the first env folder variable value
    Then the window should be clean
