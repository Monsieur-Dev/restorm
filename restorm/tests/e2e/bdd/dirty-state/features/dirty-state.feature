Feature: Dirty-state propagation across nested units
  After importing a Petstore spec the app auto-saves, so everything starts
  clean. Each edit flips the right combination of per-unit dirty dots and
  the global window title. Per-unit Ctrl+S clears only the active unit;
  Ctrl+Shift+S clears every unit. This holds in both file and folder mode.

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

  Scenario: Dirty-state in folder mode
    Given a new folder YAML collection named "dirty-collection"
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
