Feature: Full workflow end-to-end scenario
  Long-running linear scenario driven by a mocked persistence layer
  (pre-seeded config.json). Starts from an empty file, creates a new
  single-file collection, imports every supported format, and exercises
  the workbench (tabs, navigation, search, rename, env variables, tags,
  docs) before verifying that state survives close/reopen.

  Scenario: Mocked persistence drives bounds, new-file workflow, and imports
    Given a fresh app seeded with the main window at x=10 y=10
    Then the window bounds should be at x=10 y=10
    When I move and resize the window to x=120 y=80 width=1200 height=800
    And I close the app
    And I relaunch the app
    Then the window bounds should be x=120 y=80 width=1200 height=800

    When I create a new single-file YAML collection named "workflow-collection"
    Then the file "workflow-collection.restorm" should exist in the temp dir
    When I close the current file
    Then the welcome screen should be visible
    And the welcome recent files should contain "workflow-collection.restorm"

    When I favorite the welcome recent file "workflow-collection.restorm"
    Then the welcome favorites should contain "workflow-collection.restorm"
    When I unfavorite the welcome favorite "workflow-collection.restorm"
    Then the welcome favorites should not contain "workflow-collection.restorm"

    When I open the welcome recent file "workflow-collection.restorm"
    Then the welcome screen should not be visible

    When I open the import modal
    And I paste the sample file "swagger-petstore.json" into the import source
    Then the import preview should be visible
    When I clear the import source
    Then the import preview should not be visible
    When I cancel the import modal

    When I import the URL "http://localhost:8080/api/swagger.json"
    # OData — the AspNetCoreOData petstore exposes its CSDL/EDMX at
    # /odata/$metadata. Exercises the Phase-1 EDMX v4 parser + the
    # format detector added in OYO-181. The generated folder name is
    # the schema namespace (`OData.PetStore.Models`).
    When I import the URL "http://localhost:5100/odata/$metadata"
    When I import the sample file "swagger-petstore.json"
    When I import the sample file "asyncapi-docker.yaml"
    When I import the sample file "asyncapi-petstore.yaml"
    When I import the sample file "bruno-petstore.json"
    When I import the sample file "graphql-docker.graphql"
    When I import the sample file "graphql-petstore.graphql"
    When I import the sample file "grpc-docker.proto"
    When I import the sample file "grpc-petstore.proto"
    When I import the sample file "insomnia-petstore.json"
    When I import the sample file "postman-petstore.json"
    When I import the sample file "soap-docker.wsdl"
    When I import the sample file "soap-petstore.wsdl"
    # Save everything once, after the full batch: per-unit Ctrl+S would
    # only commit the active tab's subtree, so a run of imports needs a
    # single Ctrl+Shift+S to flush the whole tree to disk.
    When I save all with Ctrl+Shift+S
    Then the sidebar should contain the folder "Swagger Petstore"
    And the sidebar should show a child of "Swagger Petstore"
    And the sidebar should contain the folder "OData.PetStore.Models"

    When I click the sidebar collapse-all button
    Then every sidebar folder should be collapsed
    When I expand the sidebar folder "Swagger Petstore"
    Then the folder "Swagger Petstore" should have 3 collapsed children
    When I expand the sidebar folder "pet"
    Then the folder "pet" should be expanded
    When I click the sidebar request "Find pet by ID"
    Then a request tab for "Find pet by ID" should be open
    # Breadcrumb navigation must open a workbench tab for the clicked
    # segment, not just select it in the sidebar. Clicking "pet" while
    # on the "Find pet by ID" breadcrumb should open a folder tab for
    # pet alongside the request tab.
    When I click the breadcrumb folder "pet" in the active tab
    Then a folder tab for "pet" should be open
    When I focus the "Find pet by ID" tab
    # Middle-click opens the tab in the background: the segment's tab
    # appears in the workbench but the currently-focused tab stays
    # focused, and the sidebar selection doesn't move.
    When I middle-click the breadcrumb folder "Swagger Petstore" in the active tab
    Then a folder tab for "Swagger Petstore" should be open
    And the active tab should be "Find pet by ID"
    When I select the "localhost" environment on the active request tab
    When I fill the first path-param value with "1"
    # Per-unit dirty-state / title behaviour lives in the dedicated
    # `dirty-state.feature` — this scenario only cares that the URL
    # resolver + handlebars pipeline sees the new path param.
    When I save the file with Ctrl+S
    Then the active request resolved URL should be "http://localhost:8080/api/pet/1"
    # Changing the path-param value must update the URL tooltip
    # reactively through the URLResolver + handlebars pipeline.
    When I fill the first path-param value with "99999"
    Then the active request resolved URL should be "http://localhost:8080/api/pet/99999"
    When I fill the first path-param value with "1"
    Then the active request resolved URL should be "http://localhost:8080/api/pet/1"
    When I save the file with Ctrl+S
    When I open the search bar
    And I search for "pet"
    Then I should see search results
    When I click on the search result containing "Deletes a pet"
    Then a request tab for "Deletes a pet" should be open
    When I focus the "Find pet by ID" tab
    When I record the tab ids for folder "Swagger Petstore" with subfolder "pet" and request "Find pet by ID"
    And I close the current file
    Then the welcome screen should be visible
    When I seed the workbench with the recorded folder and request tabs side-by-side
    And I open the welcome recent file "workflow-collection.restorm"
    Then a folder tab for "Swagger Petstore" should be open
    And a request tab for "Find pet by ID" should be open
    When I focus the "Find pet by ID" tab
    Then the active request tab should show the "localhost" environment
    And the active request resolved URL should be "http://localhost:8080/api/pet/1"
    # When a folder was imported from any supported spec (Swagger,
    # AsyncAPI, GraphQL, gRPC, SOAP, Postman, Insomnia, Bruno) its Docs
    # tab should be populated with compiled markdown starting with the
    # API title.
    Then the folder tab Docs tab should be populated with compiled markdown
    # Doc-tab un-match test: while the URL still matches a Swagger route,
    # the request Docs tab is visible. Typing a non-matching prefix hides
    # it AND marks the file dirty; reverting the prefix restores both —
    # the dirty flag clears without a Ctrl+S because the checksum rolls
    # back to the last-saved state.
    When I focus the "Find pet by ID" tab
    Then the request Docs tab should be visible
    When I focus the URL field at the start
    And I type "x" character by character with delay 0 ms
    And the request Docs tab should not be visible
    When I press Backspace in the URL field
    And the request Docs tab should be visible
    When I open the search bar
    And I search for "pet"
    Then I should see search results
    When I close the search bar

    When I focus the "Swagger Petstore" folder tab
    And I set the folder tab icon to codicon "heart"
    Then the folder tab breadcrumb icon should be "heart"
    When I save the file with Ctrl+S

    When I switch to the "Environments" inner tab
    When I add a variable "themeColor" of type color to the env folder
    Then the environment-folder variables table color picker should be visible
    When I add a variable "launchDate" of type dateTime to the env folder
    Then the env folder variables should have a dateTime cell
    When I save the file with Ctrl+S
    # Edit + revert + close/reopen scenarios for dirty-state live in
    # `dirty-state.feature`; full-workflow just needs the reopen flow to
    # work for the env-switch / variable-type checks below.
    # Sidebar expansion state must survive close/reopen (OYO-190) —
    # set a distinguishable pattern (root + pet expanded, user collapsed)
    # so we can't mistake the default "expand everything" fallback for
    # a successful restore.
    When I expand the sidebar folder "Swagger Petstore"
    And I expand the sidebar folder "pet"
    And I collapse the sidebar folder "user"
    Then the sidebar folder "Swagger Petstore" should be expanded
    And the sidebar folder "pet" should be expanded
    And the sidebar folder "user" should be collapsed
    # Give the debounced storage write (300ms) a chance to land before
    # the app closes; without this sleep the close race can drop the write.
    When I wait for sidebar expansion to persist
    When I close the current file
    When I open the welcome recent file "workflow-collection.restorm"
    Then the sidebar folder "Swagger Petstore" should be expanded
    And the sidebar folder "pet" should be expanded
    And the sidebar folder "user" should be collapsed
    When I click the sidebar env folder "Swagger Petstore"
    When I switch to the "Environments" inner tab
    # Variable types must be preserved across env switches: `themeColor`
    # lives on the `localhost` env. Switch to the `https` sub-env and
    # back — the color picker cell should re-appear on the parent env
    # unchanged (type preserved).
    When I click the env folder environment named "https"
    When I click the env folder environment named "localhost"
    Then the environment-folder variables table color picker should be visible

    # ── Context variables table: resolved values ──
    # The context pane shows resolved variables with {{handlebars}} names.
    Then the context variables table should contain "scheme" with value "http"
    And the context variables table should contain "host" with value "localhost"
    And the context variables table should contain "port" with value "8080"
    And the context variables table should contain "baseUrl" with value "http://localhost:8080/api"
    # Editing a variable should update the resolved context in real time
    When I change the env variable "port" value to "9090"
    Then the context variables table should contain "port" with value "9090"
    And the context variables table should contain "baseUrl" with value "http://localhost:9090/api"
    # Revert the change
    When I change the env variable "port" value to "8080"
    Then the context variables table should contain "baseUrl" with value "http://localhost:8080/api"
    # Adding a new variable should appear in the context table
    When I add a new env variable "apiKey" with value "test-key-123"
    Then the context variables table should contain "apiKey" with value "test-key-123"
    # Deleting the variable should remove it from the context table
    When I delete the env variable "apiKey"
    Then the context variables table should not contain "apiKey"

    # Notes edit + revert dirty-state cycle is covered in
    # `dirty-state.feature` — not re-exercised here.

    When I add tag "pet" to the active folder tab
    Then the active folder tab should have tag "pet"
    When I save the file with Ctrl+S
    When I set the color of the folder tab's "pet" tag to yellow
    Then the folder tab's "pet" tag should be colored yellow
    And the request tab's "pet" tag should be colored yellow
    When I save the file with Ctrl+S
    When I remove tag "pet" from the active folder tab
    Then the active folder tab should not have tag "pet"
    When I save the file with Ctrl+S

    # ── Docs tab visibility tracks URL ↔ apiDocumentation match ──
    # Open "Find pet by ID" and confirm the request Docs tab (sat
    # between Request and Notes) is mounted because the URL matches
    # an operation in the imported apiDocumentation. Rewriting the
    # URL to a path the spec doesn't describe (`/pet/` → `/animal/`)
    # severs that match and the Docs tab should disappear.
    When I open the sidebar request "Find pet by ID"
    Then the request Docs tab should be visible
    When I replace "/pet/" with "/animal/" in the URL field
    Then the request Docs tab should not be visible

    # ── Favorites: sidebar context menu ──
    When I focus the "Swagger Petstore" folder tab
    When I switch to the "home" inner tab
    When I expand the sidebar folder "Swagger Petstore"
    When I expand the sidebar folder "pet"
    When I right-click the sidebar request "Find pet by ID" and add to favorites
    Then the home favorites section should contain "Find pet by ID"
    When I right-click the sidebar request "Find pet by ID" and remove from favorites
    Then the home favorites section should not be visible
    # ── Favorites: tab context menu ──
    When I right-click the tab "Find pet by ID" and add to favorites
    When I focus the "Swagger Petstore" folder tab
    When I switch to the "home" inner tab
    Then the home favorites section should contain "Find pet by ID"
    When I right-click the tab "Find pet by ID" and remove from favorites
    When I focus the "Swagger Petstore" folder tab
    When I switch to the "home" inner tab
    Then the home favorites section should not be visible
    # ── Favorites: remove from home page context menu ──
    When I right-click the sidebar request "Find pet by ID" and add to favorites
    Then the home favorites section should contain "Find pet by ID"
    When I right-click "Find pet by ID" in the home favorites and remove
    Then the home favorites section should not be visible

    When I focus the "Swagger Petstore" folder tab
    And I expand the sidebar folder "Swagger Petstore"
    And I expand the sidebar folder "pet"
    And I open the sidebar request "Add a new pet to the store"
    Then a request tab for "Add a new pet to the store" should be open
    When I focus the "Find pet by ID" tab
    And I open the sidebar request "Deletes a pet"
    Then a request tab for "Deletes a pet" should be open

    # Holding Ctrl while pressing Tab opens the tab switcher overlay,
    # which lists recently-visited tabs in reverse nav order (most
    # recent at index 0). Releasing Ctrl dismisses it.
    When I hold Ctrl and press Tab to open the tab switcher
    Then the tab switcher item at index 0 should contain "Deletes a pet"
    And the tab switcher item at index 1 should contain "Find pet by ID"
    And the tab switcher item at index 2 should contain "Add a new pet to the store"
    When I release Ctrl

    # Collapsing a folder and then clicking a workbench tab whose
    # request lives in that folder must re-expand the parent folder in
    # the sidebar.
    When I collapse the sidebar folder "pet"
    Then the sidebar folder "pet" should be collapsed
    When I focus the "Find pet by ID" tab
    Then the sidebar folder "pet" should be expanded

    # Reset focus to the penultimate-visited sequence expected by the back/forward
    # test: click the target tab explicitly so its id sits at currentIndex-1 in
    # the nav history.
    When I focus the "Find pet by ID" tab
    And I focus the "Deletes a pet" tab
    # A single back + single forward must restore the previously-
    # visited tab and leave the forward button disabled at the tip of
    # history.
    When I click the titlebar back button
    Then the active tab title should be "Find pet by ID"
    When I click the titlebar forward button
    Then the active tab title should be "Deletes a pet"
    And the titlebar forward button should be disabled
    When I middle-click the tab "Find pet by ID"
    Then no tab with title "Find pet by ID" should be open
    When I click the titlebar back button until "Find pet by ID" is open
    Then a request tab for "Find pet by ID" should be open

    # Right-click "Find pet by ID" + close-others closes its sibling tabs in
    # the same group. Other groups are untouched — the exact final count
    # depends on which group the reopened tab landed in.
    When I right-click the tab "Find pet by ID" and choose close-others
    Then exactly 3 workbench tabs should be open

    When I save the file with Ctrl+S
    When I close the current file
    # Opening a file through the mocked system open-file dialog via
    # the Ctrl+O shortcut must restore the previously-persisted
    # workbench tabs, same as clicking the recent file from the
    # welcome screen.
    And I open the "workflow-collection.restorm" file via Ctrl+O
    Then exactly 3 workbench tabs should be open

    When I close every open tab in the workbench
    And I close the current file
    Then a title-bar search for "pet" should return no results
    When I open the welcome recent file "workflow-collection.restorm"
    Then exactly 0 workbench tabs should be open

    # A unique phrase typed into the request's Notes field must
    # surface via the titlebar search and be distinct from the
    # "debounce" / "pet" hits checked earlier.
    When I expand the sidebar folder "Swagger Petstore"
    And I expand the sidebar folder "pet"
    And I click the sidebar request "Add a new pet to the store"
    Then a request tab for "Add a new pet to the store" should be open
    When I open the request Notes tab and type "uniqueNoteKeyword"
    And I save the file with Ctrl+S
    When I open the search bar
    And I search for "uniqueNoteKeyword"
    Then I should see search results
    When I hover over the first search result
    Then the title-bar search tooltip should be visible
    When I close the search bar

    # Renaming a FOLDER (not just a request) via the sidebar must make
    # the new name reachable through the titlebar search index.
    When I rename "Swagger Petstore" to "SwaggerRenamedFolder" in the sidebar
    When I save the file with Ctrl+S
    When I open the search bar
    And I search for "SwaggerRenamedFolder"
    Then the title-bar search results should contain a hit mentioning "SwaggerRenamedFolder"
    When I close the search bar

    # Re-open a request to exercise the Monaco-backed URL field: it
    # must not drop characters under fast typing nor under the
    # CodeEditor's 200ms debounce.
    When I expand the sidebar folder "Swagger Petstore"
    And I expand the sidebar folder "pet"

    # Cloning a request must land in the search index immediately — the
    # clone emits the same document-created events as any create, so the
    # copy is searchable without a file reload.
    When I clone the sidebar request "Find pet by ID"
    And I open the search bar
    And I search for "Find pet by ID (copy)"
    Then the title-bar search results should contain a hit mentioning "(copy)"
    When I close the search bar

    When I click the sidebar request "Find pet by ID"
    Then a request tab for "Find pet by ID" should be open
    When I focus the URL field at the start
    And I type "debounce" character by character with delay 0 ms
    Then the URL field should start with "debounce"
    When I focus the URL field at the start
    And I type "debounce" character by character with delay 200 ms
    Then the URL field should start with "debouncedebounce"

    # The typed "debouncedebounce" lives in the Find pet by ID
    # request's URL field, which is a searchable property. Results are
    # displayed with the REQUEST name (not the URL content) — assert
    # the search is non-empty and that switching query updates the
    # results.
    When I save the file with Ctrl+S
    When I open the search bar
    And I search for "debouncedebounce"
    Then I should see search results
    When I search for "pet"
    Then I should see search results
    When I close the search bar

    # Rename the request via the sidebar and verify the new name
    # surfaces in the titlebar search — covers the sidebar rename flow
    # and the search index refresh together.
    When I rename "Find pet by ID" to "SearchableRenamed" in the sidebar
    When I save the file with Ctrl+S
    When I open the search bar
    And I search for "SearchableRenamed"
    Then the title-bar search results should contain a hit mentioning "SearchableRenamed"
    When I close the search bar

    # The env selected on a request must survive a rename + close-tab
    # + reopen cycle. The "localhost" env was selected on "Find pet by ID"
    # earlier; after renaming to "SearchableRenamed" and middle-
    # closing the tab, reopening from the sidebar should bring the
    # "localhost" env back — the selection is keyed by stable id, not by
    # request name.
    When I focus the "SearchableRenamed" tab
    Then the active request tab should show the "localhost" environment
    When I middle-click the tab "SearchableRenamed"
    Then no tab with title "SearchableRenamed" should be open
    When I open the sidebar request "SearchableRenamed"
    Then a request tab for "SearchableRenamed" should be open
    When I focus the "SearchableRenamed" tab
    Then the active request tab should show the "localhost" environment

    # Sidebar "Ajouter" submenu: every entry builds a properly-typed
    # empty item under the right-clicked parent, registers it with the
    # reactive store, and opens a workbench tab. We create a folder
    # first, then drop one of every request type into it so the badge
    # + tab-open contract is exercised end-to-end. The created names
    # are the untranslated defaults `handleAddChildItem` emits.
    When I close every open tab in the workbench
    And I add a "folder" under the folder "SwaggerRenamedFolder" via the sidebar Ajouter submenu
    Then the sidebar should contain the folder "New Folder"
    And a folder tab for "New Folder" should be open
    When I add a "http-get" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New GET request"
    And a request tab for "New GET request" should be open
    When I add a "http-post" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New POST request"
    When I add a "http-put" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New PUT request"
    When I add a "http-patch" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New PATCH request"
    When I add a "http-delete" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New DELETE request"
    When I add a "graphql" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New GraphQL request"
    When I add a "grpc" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New gRPC request"
    When I add a "soap" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New SOAP request"
    When I add a "websocket" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New WebSocket request"
    When I add a "odata" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New OData request"
    When I add a "auth" under the folder "New Folder" via the sidebar Ajouter submenu
    Then the sidebar should contain the request "New auth request"

    # Empty-area sidebar Ajouter submenu — root-level HTTP request,
    # then verify it shows up in the global search results (regression
    # for the SearchIndexService bail-out on missing parentFolderId).
    # The earlier "New Folder" step already created a "New GET request"
    # nested under it, so we rename the freshly-added root copy to a
    # unique probe string. Then searching for that probe proves the
    # ROOT request was indexed (not just the nested one).
    When I add a root-level "http-get" via the sidebar empty-area Ajouter submenu
    And I rename the last sidebar request "New GET request" to "RootSearchProbe"
    Then the sidebar should contain the request "RootSearchProbe"
    # Persist before searching — the rename above marks the file dirty,
    # and the close-app step at the very end can't tolerate the unsaved-
    # changes confirmation dialog (it's intentionally not mocked).
    When I save the file with Ctrl+S
    When I open the global search bar
    And I type "RootSearchProbe" in the global search bar
    Then a global search result should match "RootSearchProbe"
    When I close the global search bar

    # Ctrl+Alt+Left/Right: send the focused tab to the adjacent group
    # (create a new one on demand). Exercises the 6 canonical layout
    # transitions the shortcut supports. A = "Add a new pet to the store",
    # B = "Deletes a pet", C = the renamed "SearchableRenamed" request.
    When I close every open tab in the workbench
    And I expand the sidebar folder "SwaggerRenamedFolder"
    And I expand the sidebar folder "pet"
    And I click the sidebar request "Add a new pet to the store"
    And I click the sidebar request "Deletes a pet"
    And I focus the "Add a new pet to the store" tab
    Then the workbench layout should be "POSTAdd a new pet to the store*,DELETEDeletes a pet"
    When I press Ctrl+Alt+Right
    Then the workbench layout should be "DELETEDeletes a pet*|POSTAdd a new pet to the store*"
    When I press Ctrl+Alt+Left
    Then the workbench layout should be "DELETEDeletes a pet,POSTAdd a new pet to the store*"
    When I press Ctrl+Alt+Left
    Then the workbench layout should be "POSTAdd a new pet to the store*|DELETEDeletes a pet*"

    When I close every open tab in the workbench
    And I click the sidebar request "Add a new pet to the store"
    And I click the sidebar request "Deletes a pet"
    And I click the sidebar request "SearchableRenamed"
    And I focus the "SearchableRenamed" tab
    When I press Ctrl+Alt+Right
    Then the workbench layout should be "POSTAdd a new pet to the store*,DELETEDeletes a pet|GETSearchableRenamed*"
    When I focus the "Add a new pet to the store" tab
    And I press Ctrl+Alt+Right
    Then the workbench layout should be "DELETEDeletes a pet*|GETSearchableRenamed,POSTAdd a new pet to the store*"
    When I press Ctrl+Alt+Right
    Then the workbench layout should be "DELETEDeletes a pet*|GETSearchableRenamed*|POSTAdd a new pet to the store*"
    # No-op: "Add a new pet to the store" is already the only tab in the
    # rightmost group, so there's nothing to send further right.
    When I press Ctrl+Alt+Right
    Then the workbench layout should be "DELETEDeletes a pet*|GETSearchableRenamed*|POSTAdd a new pet to the store*"

    # Save-all + close-file must NOT pop the "Save changes before
    # closing?" modal, AND the project's drafts directory must be
    # empty afterwards. Orphan drafts otherwise trigger a bogus
    # "drafts restored" toast on next launch.
    When I rename the sidebar request "Add a new pet to the store" to "DraftCleanProbe"
    And I save all with Ctrl+Shift+S

    # ── AutoSave (`files:autoSave` + `files:autoSaveDelay`) ──
    # Drives the in-process AutoSaveController end-to-end through the
    # real settings UI: open the modal, click the dropdown, pick the
    # option, set the delay, close. We target the "DraftCleanProbe"
    # tab specifically (renamed from "Add a new pet to the store"
    # above) — the multi-group workbench means the abstract "active
    # tab" matches one tab per group, so checking the dirty dot on a
    # specific tab is the only way to attribute dirty state correctly.
    # Each scenario waits 700 ms after a state-changing action to
    # give the controller's debounce timer (set to 500 ms) plus the
    # IPC round-trip time enough room without flaking.

    When I focus the "DraftCleanProbe" tab
    Then the window title should be clean

    # 1. With autosave OFF (default), an edit stays dirty indefinitely.
    When I append "x" to the active request URL
    Then the window title should be dirty
    When I wait 700ms
    Then the window title should be dirty

    # 2. Enabling autosave (afterDelay, 500 ms) via the settings UI,
    #    while a dirty doc is already open, arms the timer immediately
    #    — the user's pending edit must be picked up without typing
    #    one more character.
    When I open the settings modal
    And I set the autoSaveDelay setting to 500
    And I select autoSave option 1 in the settings modal
    And I close the settings modal
    And I wait 700ms
    Then the window title should be clean

    # 3. With autosave ON, a fresh edit clears within the delay.
    When I append "y" to the active request URL
    Then the window title should be dirty
    When I wait 700ms
    Then the window title should be clean

    # 4. Disabling autosave (option 0 = off) restores manual-only
    #    behaviour: the dirty dot stays after the delay because nothing
    #    fires a save.
    When I open the settings modal
    And I select autoSave option 0 in the settings modal
    And I close the settings modal
    And I append "z" to the active request URL
    Then the window title should be dirty
    When I wait 700ms
    Then the window title should be dirty
    # Bring the file back to a clean state so the rest of the
    # scenario continues with the existing assumptions.
    When I save all with Ctrl+Shift+S
    Then the window title should be clean

    # Close-file with "Don't save" must wipe the drafts too. The
    # save-on-quit modal otherwise leaves a per-unit draft behind
    # that the next launch reads as a recovery candidate, even
    # though the user explicitly chose to discard. Edit-then-revert
    # detection is unit-tested at the registry layer (sameSerialized
    # fallback) — covering it end-to-end requires fragile coordination
    # with the reactive proxy's intermediate keystroke events during
    # rename, so we don't try here.
    When I rename the sidebar request "DraftCleanProbe" to "DraftCleanProbeY"
    And I close the current file and discard changes
    Then the project's drafts directory should be empty

    When I close the app
    Then the saved main window bounds should be x=120 y=80 width=1200 height=800
    And no errors should have been logged

  Scenario: Selective import drops the unchecked group
    # Stand alone scenario — the long workflow above already imported
    # the full Petstore, so this one starts with a fresh collection
    # to keep the assertions about "what got imported" tight.
    Given a fresh app seeded with the main window at x=10 y=10
    When I create a new single-file YAML collection named "selective-import"
    Then the file "selective-import.restorm" should exist in the temp dir

    When I selectively import the Petstore swagger excluding the "store" folder
    And I save all with Ctrl+Shift+S
    Then the imported tree should not contain any "store" routes

    When I close the app
    Then no errors should have been logged

  # Workspace settings overlay — picking a non-default theme on the
  # Workspace tab must (a) update the rendered window background,
  # (b) write `<dir>/.restorm/settings.json` with the chosen theme,
  # (c) revert the background once the file is closed (the workspace
  # overlay is dropped, the user-level theme reasserts).
  Scenario: Workspace settings overlay applies a theme persistently and reverts on close
    Given a fresh app seeded with the main window at x=10 y=10
    When I create a new single-file YAML collection named "workspace-theme-test"
    Then the file "workspace-theme-test.restorm" should exist in the temp dir

    When I capture the window background color as "initial"
    And I open the settings modal
    And I switch to the workspace settings tab
    And I pick a non-current theme in the settings page
    And I close the settings modal
    Then the window background color should differ from "initial"
    And the workspace settings file for "workspace-theme-test" should contain key "appearance:theme"

    When I close the current file and discard changes
    Then the window background color should equal "initial"

    When I close the app
    Then no errors should have been logged

  Scenario: Firewall + Console workbench surfaces — singleton tabs, panel CRUD, format toggle
    Given a fresh app seeded with the main window at x=20 y=20
    When I create a new single-file YAML collection named "firewall-console-collection"

    # ─── View → Firewall ────────────────────────────────────────────
    When I open the firewall panel via the view menu
    Then the firewall panel should be visible
    And the firewall whitelist count should be 0
    And the firewall blacklist count should be 0

    When I add "https://api.example.com" to the firewall whitelist
    Then the firewall whitelist count should be 1
    And the firewall whitelist should contain "https://api.example.com"

    # Subdomain wildcard — accepted shape.
    When I add "https://*.trusted.example.com" to the firewall whitelist
    Then the firewall whitelist count should be 2
    And the firewall whitelist should contain "https://*.trusted.example.com"

    # Malformed wildcard — rejected silently (Add button no-ops).
    When I add "https://*notavaliddomain" to the firewall whitelist
    Then the firewall whitelist count should be 2

    When I switch to the firewall blacklist tab
    Then the firewall blacklist count should be 0
    When I add "https://tracker.evil.example" to the firewall blacklist
    Then the firewall blacklist count should be 1

    # Re-opening View → Firewall focuses the existing tab (singleton).
    When I open the firewall panel via the view menu
    Then exactly one firewall tab should be open

    # ─── View → Console ─────────────────────────────────────────────
    When I open the console via the view menu
    Then the console panel should be visible
    And the console toolbar should default to curl
    When I toggle the console shell to powershell
    Then the console shell setting should be persisted as powershell

    # Re-opening View → Console focuses the existing tab (singleton).
    When I open the console via the view menu
    Then exactly one console tab should be open

    # ─── Maximize / restore a special tab ───────────────────────────
    # Console / Firewall / Mini browser tabs opt into `allowFullscreen`,
    # so a double-click maximizes them into the shared fullscreen modal
    # — the same React instance, so no panel state is lost. Restoring
    # via the modal close button drops the content back into its slot.
    When I double-click the console workbench tab
    Then the fullscreen workbench modal should be visible
    And the console panel should be visible
    When I close the fullscreen workbench modal
    Then the fullscreen workbench modal should be hidden
    And the console panel should be visible

    When I close the app
    Then no errors should have been logged

  # EmptyBench recent-activity card + per-request panel-collapsed
  # persistence end-to-end. Exercises:
  #   1. send order → recent-activity row order (most-recent-first)
  #   2. clicking a recent row opens the request tab
  #   3. send moves the row to position 0 (the LRU-style reordering)
  #   4. collapsed panes survive tab close+reopen via the user-level
  #      `request_panel_state:<projectUuid>` store
  #   5. renaming the request in the sidebar propagates to the recent
  #      list label (live-tracking via rootItems prop)
  #   6. deleting the request drops it from the recent list
  Scenario: EmptyBench recent activity ↔ panel-state persistence ↔ rename/delete tracking
    Given a fresh app seeded with the main window at x=10 y=10
    When I create a new single-file YAML collection named "empty-bench-activity"
    Then the file "empty-bench-activity.restorm" should exist in the temp dir

    # Three GET requests from the petstore swagger to populate Recent
    # activity in a deterministic order: A → B → C ⇒ Recent = [C, B, A].
    When I import the URL "http://localhost:8080/api/swagger.json"
    And I save all with Ctrl+Shift+S

    When I open the sidebar request "Find pet by ID"
    And I click the send button in the active request tab
    When I open the sidebar request "Finds Pets by status"
    And I click the send button in the active request tab
    When I open the sidebar request "Finds Pets by tags"
    And I click the send button in the active request tab

    When I close every open tab in the workbench
    # Recent activity ordering: newest-first ⇒ position 0 is the last
    # request sent, position 1 the previous, etc.
    Then the recent-activity row at index 0 should be the request "Finds Pets by tags"
    And the recent-activity row at index 1 should be the request "Finds Pets by status"
    And the recent-activity row at index 2 should be the request "Find pet by ID"

    # Click the SECOND row to open "Finds Pets by status", collapse every
    # pane inside, send, close. The send moves the request to row 0 and
    # the collapsed panes persist via the user-level store.
    When I click the recent-activity row at index 1
    Then the active tab title should be "Finds Pets by status"
    When I collapse every visible pane in the active request tab
    And I click the send button in the active request tab
    Then every pane in the active request tab should be collapsed
    When I close every open tab in the workbench

    # After the send the row moves to position 0 — most-recent-first.
    Then the recent-activity row at index 0 should be the request "Finds Pets by status"

    # Reopen from the recent card — collapsed-panes state survives tab
    # close because the store is keyed by request id, not by tab.
    When I click the recent-activity row at index 0
    Then the active tab title should be "Finds Pets by status"
    And every pane in the active request tab should be collapsed

    # Rename in the sidebar — the recent card live-tracks `rootItems`,
    # so its label updates without a manual refresh. We deliberately
    # leave the tab open while renaming: the rename step clicks the
    # sidebar row then presses F2, and a fresh "click on a request
    # opens a tab" cycle would shift focus to the new tab and swallow
    # the F2 key. Then we close the tab to land back on EmptyBench
    # before asserting the recent-activity row label.
    #
    # Delete-from-sidebar coverage (Recent row drops + the renderer's
    # REQUEST_DELETED handler clearing the panel-state store entry)
    # is exercised by `requestPanelStateStore` unit tests rather than
    # this e2e — the sidebar context-menu Delete item routes through
    # a confirmation modal that adds enough orchestration to make
    # the end-to-end run flaky in CI; the persistence + rename arc
    # is the part of this feature that needed the live integration.
    When I rename the sidebar request "Finds Pets by status" to "Finds Pets by status (renamed)"
    And I close every open tab in the workbench
    Then the recent-activity row at index 0 should be the request "Finds Pets by status (renamed)"

    # Discard the rename before quitting — closing the app with an
    # unsaved collection would pop the native "Save changes?" dialog
    # which the e2e harness fails open on.
    When I close the current file and discard changes
    And I close the app
    Then no errors should have been logged

  # Custom value lists: a user-defined label→value map on an env folder.
  # A request param bound to a list substitutes the selected label's
  # current value at dispatch (resolved in the main process). Editing,
  # renaming, disabling and deleting the list flow through live; an
  # unresolvable selection sends empty (no label fallback).
  Scenario: Custom value lists substitute at dispatch and react to edits
    Given a fresh app seeded with the main window at x=10 y=10
    And I open the custom-value-lists sample collection
    When I open the custom-list "Paint" request
    And I select the "live" environment on the active request tab
    # Use → the entry value is substituted for the label.
    Then the active request resolved URL should be "https://api.example.com/paint?color=FF0000"

    # Edit the value → the new value is dispatched live.
    When I open the custom variables tab on the "Paint API" env folder
    And I select the "Couleur" custom value list
    And I set the "Rouge" custom-list entry value to "0000FF"
    When I focus the custom-list "Paint" request tab
    Then the active request resolved URL should be "https://api.example.com/paint?color=0000FF"

    # Reorder the values → the picker of the ALREADY-OPEN request follows,
    # without closing and reopening the tab, and the selection stays on the
    # label the user chose rather than on the position it used to occupy.
    When I focus the custom-list "Paint" request tab
    Then the custom-list picker of the active request should offer "Rouge, Vert"
    When I open the custom variables tab on the "Paint API" env folder
    And I drag the "Vert" custom-list entry above "Rouge"
    When I focus the custom-list "Paint" request tab
    Then the custom-list picker of the active request should offer "Vert, Rouge"
    And the active request resolved URL should be "https://api.example.com/paint?color=0000FF"

    # Rename the list → the binding holds (resolved by id, not name).
    When I open the custom variables tab on the "Paint API" env folder
    And I rename the "Couleur" custom value list to "Teinte"
    When I focus the custom-list "Paint" request tab
    Then the active request resolved URL should be "https://api.example.com/paint?color=0000FF"

    # Disable the entry → unresolvable. A param whose value resolves to nothing
    # is OMITTED rather than sent as a bare `color=`: the server reads "absent",
    # which is what the empty context expressed, not "present and empty".
    When I open the custom variables tab on the "Paint API" env folder
    And I select the "Teinte" custom value list
    And I uncheck the "Rouge" custom-list entry
    When I focus the custom-list "Paint" request tab
    Then the active request resolved URL should be "https://api.example.com/paint"

    # Re-enable → resolution returns.
    When I open the custom variables tab on the "Paint API" env folder
    And I select the "Teinte" custom value list
    And I check the "Rouge" custom-list entry
    When I focus the custom-list "Paint" request tab
    Then the active request resolved URL should be "https://api.example.com/paint?color=0000FF"

    # Delete the whole list → unresolvable, so the param is omitted entirely
    # (same rule as the unchecked entry above).
    When I open the custom variables tab on the "Paint API" env folder
    And I delete the "Teinte" custom value list
    When I focus the custom-list "Paint" request tab
    Then the active request resolved URL should be "https://api.example.com/paint"

    When I close the current file and discard changes
    And I close the app
    Then no errors should have been logged

  # Ctrl+Tab most-recently-used ordering must treat special / singleton
  # tabs (Console, Firewall) as first-class: they interleave with regular
  # request tabs in true MRU order rather than being forced to the end.
  # Closing the active tab returns to the most-recently-used previous tab
  # ACROSS ALL GROUPS (VSCode-style) — consistent with the switcher.
  Scenario: Ctrl+Tab MRU + close-returns-to-previous across regular and special tabs
    Given a fresh app seeded with the main window at x=10 y=10
    When I create a new single-file YAML collection named "mru-tabs-collection"
    And I import the URL "http://localhost:8080/api/swagger.json"
    And I save all with Ctrl+Shift+S

    # Two regular request tabs (one group), then the two special tabs
    # (Console / Firewall open in a separate split group). Most-recent
    # activation order ends up:
    # Firewall, Console, Finds Pets by status, Find pet by ID.
    When I open the sidebar request "Find pet by ID"
    And I open the sidebar request "Finds Pets by status"
    And I open the console via the view menu
    And I open the firewall panel via the view menu

    # The switcher lists every tab type interleaved by MRU — special tabs
    # are NOT dumped to the end (the reported bug).
    When I hold Ctrl and press Tab to open the tab switcher
    Then the tab switcher item at index 0 should contain "Firewall"
    And the tab switcher item at index 1 should contain "Console"
    And the tab switcher item at index 2 should contain "Finds Pets by status"
    And the tab switcher item at index 3 should contain "Find pet by ID"
    When I release Ctrl

    # Re-activate across the split: click a special tab (bottom group), then
    # a request tab (top group). MRU is now:
    # Finds Pets by status > Console > Firewall > Find pet by ID.
    When I focus the "Console" tab
    And I focus the "Finds Pets by status" tab

    # Closing the active "Finds Pets by status" closes a tab in a group that
    # SURVIVES (its sibling "Find pet by ID" remains), yet the GLOBAL
    # MRU-previous is "Console" in the OTHER group — focus must MOVE there,
    # not fall back to the adjacent "Find pet by ID" in the closed group.
    # Asserting against the FOCUSED group (each split group keeps its own
    # active tab) is what proves focus actually crossed groups — this is the
    # exact regression: close-to-previous must match the global switcher MRU.
    Then the focused group active tab title should be "Finds Pets by status"
    When I close the active tab
    Then the focused group active tab title should be "Console"

    When I close the app
    Then no errors should have been logged

  Scenario: Deleting a request from the sidebar drops it from the search index
    Given a fresh app seeded with the main window at x=10 y=10
    When I create a new single-file YAML collection named "delete-search"
    Then the file "delete-search.restorm" should exist in the temp dir
    When I import the URL "http://localhost:8080/api/swagger.json"
    And I save all with Ctrl+Shift+S

    # The imported request is searchable to begin with.
    When I open the search bar
    And I search for "Find pet by ID"
    Then the title-bar search results should contain a hit mentioning "Find pet by ID"
    When I close the search bar

    # Delete it from the sidebar (context menu → Delete → confirm). This is
    # the path that must announce REQUEST_DELETED on both buses — the
    # main-process search index drops the entry, and the renderer marks the
    # project dirty. Before, a sidebar delete emitted nothing and the entry
    # lingered in search forever.
    When I delete the sidebar request "Find pet by ID"
    Then a title-bar search for "Find pet by ID" should return no results

    When I close the current file and discard changes
    And I close the app
    Then no errors should have been logged

  # Every root-level creation lives in the empty-area "Ajouter" submenu —
  # the menu offers nothing else at its top level (no duplicate of
  # "Ajouter > Dossier"), and the environment folder is created from that
  # same submenu rather than from a first-level entry of its own.
  #
  # Creating from that submenu also opens the new row in inline rename,
  # whatever the kind, so the user can name it without reaching for F2.
  # Both exits are covered: Enter keeps the typed name, Escape keeps the
  # default one — neither leaves a half-created item behind.
  Scenario: The sidebar empty-area menu creates root folders from the Ajouter submenu alone
    Given a fresh app seeded with the main window at x=10 y=10
    When I create a new single-file YAML collection named "empty-area-add"
    Then the file "empty-area-add.restorm" should exist in the temp dir
    And the sidebar empty-area context menu should only offer the Ajouter entry

    When I add a root-level "folder" via the sidebar empty-area Ajouter submenu, keeping the rename field open
    Then the created row should be in inline rename
    When I confirm the inline rename as "NamedOnCreate"
    Then the sidebar should contain the folder "NamedOnCreate"

    When I add a root-level environment folder via the sidebar empty-area Ajouter submenu, keeping the rename field open
    Then the created row should be in inline rename
    When I cancel the inline rename
    Then the sidebar should contain the folder "New Environment Folder"

    When I close the current file and discard changes
    And I close the app
    Then no errors should have been logged
