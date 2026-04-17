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
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "swagger-petstore.json"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "asyncapi-docker.yaml"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "asyncapi-petstore.yaml"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "bruno-petstore.json"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "graphql-docker.graphql"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "graphql-petstore.graphql"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "grpc-docker.proto"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "grpc-petstore.proto"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "insomnia-petstore.json"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "postman-petstore.json"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "soap-docker.wsdl"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I import the sample file "soap-petstore.wsdl"
    Then the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    Then the sidebar should contain the folder "Swagger Petstore"
    And the sidebar should show a child of "Swagger Petstore"

    When I click the sidebar collapse-all button
    Then every sidebar folder should be collapsed
    When I expand the sidebar folder "Swagger Petstore"
    Then the folder "Swagger Petstore" should have 3 collapsed children
    When I expand the sidebar folder "pet"
    Then the folder "pet" should be expanded
    When I click the sidebar request "Find pet by ID"
    Then a request tab for "Find pet by ID" should be open
    When I select the "http" environment on the active request tab
    Then the file's dirty-state should be: clean
    When I fill the first path-param value with "1"
    Then the file's dirty-state should be: dirty
    And the active tab should have a dirty dot
    # The "*" in the document title mirrors the file-level dirty flag
    # — shown when dirty, cleared after save.
    And the app title should contain "*"
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    And the app title should not contain "*"
    Then the active request URL tooltip should be "http://localhost:8080/api/pet/1"
    # Changing the path-param value must update the URL tooltip
    # reactively through the URLResolver + handlebars pipeline.
    When I fill the first path-param value with "99999"
    Then the active request URL tooltip should be "http://localhost:8080/api/pet/99999"
    When I fill the first path-param value with "1"
    Then the active request URL tooltip should be "http://localhost:8080/api/pet/1"
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
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
    Then the active request tab should show the "http" environment
    And the active request URL tooltip should be "http://localhost:8080/api/pet/1"
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
    Then the file's dirty-state should be: dirty
    And the request Docs tab should not be visible
    When I press Backspace in the URL field
    Then the file's dirty-state should be: clean
    And the request Docs tab should be visible
    When I open the search bar
    And I search for "pet"
    Then I should see search results
    When I close the search bar

    When I focus the "Swagger Petstore" folder tab
    And I set the folder tab icon to codicon "heart"
    Then the folder tab breadcrumb icon should be "heart"
    And the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean

    When I add a variable "themeColor" of type color to the env folder
    Then the environment-folder variables table color picker should be visible
    When I add a variable "launchDate" of type dateTime to the env folder
    Then the env folder variables should have a dateTime cell
    And the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    # ── Tab dirty state: modify + revert after save ──
    # After saving, modify a variable → tab dirty dot should appear.
    # Revert to original → both tab and file dirty should clear.
    When I edit and revert the first env folder variable
    Then the active tab should not have a dirty dot
    And the file's dirty-state should be: clean
    # ── Tab dirty state: modify + revert after close/reopen ──
    # Close and reopen the file, open the env folder tab from the
    # sidebar, modify + revert → dirty state must clear.
    When I close the current file
    When I open the welcome recent file "workflow-collection.restorm"
    When I click the sidebar env folder "Swagger Petstore"
    When I edit and revert the first env folder variable
    Then the active tab should not have a dirty dot
    And the file's dirty-state should be: clean
    # Variable types must be preserved across env switches: `themeColor`
    # lives on the `localhost` env. Switch to the `http` sub-env and
    # back — the color picker cell should re-appear on the parent env
    # unchanged (type preserved).
    When I click the env folder environment named "http"
    When I click the env folder environment named "localhost"
    Then the environment-folder variables table color picker should be visible

    When I add tag "pet" to the active folder tab
    Then the active folder tab should have tag "pet"
    And the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I set the color of the folder tab's "pet" tag to yellow
    Then the folder tab's "pet" tag should be colored yellow
    And the request tab's "pet" tag should be colored yellow
    And the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
    When I remove tag "pet" from the active folder tab
    Then the active folder tab should not have tag "pet"
    And the file's dirty-state should be: dirty
    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean

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
    When I snapshot the current window as the final screenshot

    When I save the file with Ctrl+S
    Then the file's dirty-state should be: clean
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
    Then the file's dirty-state should be: clean
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
    Then the file's dirty-state should be: clean
    When I open the search bar
    And I search for "SwaggerRenamedFolder"
    Then the title-bar search results should contain a hit mentioning "SwaggerRenamedFolder"
    When I close the search bar

    # Re-open a request to exercise the Monaco-backed URL field: it
    # must not drop characters under fast typing nor under the
    # CodeEditor's 200ms debounce.
    When I expand the sidebar folder "Swagger Petstore"
    And I expand the sidebar folder "pet"
    And I click the sidebar request "Find pet by ID"
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
    Then the file's dirty-state should be: clean
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
    Then the file's dirty-state should be: clean
    When I open the search bar
    And I search for "SearchableRenamed"
    Then the title-bar search results should contain a hit mentioning "SearchableRenamed"
    When I close the search bar

    # The env selected on a request must survive a rename + close-tab
    # + reopen cycle. The "http" env was selected on "Find pet by ID"
    # earlier; after renaming to "SearchableRenamed" and middle-
    # closing the tab, reopening from the sidebar should bring the
    # "http" env back — the selection is keyed by stable id, not by
    # request name.
    When I focus the "SearchableRenamed" tab
    Then the active request tab should show the "http" environment
    When I middle-click the tab "SearchableRenamed"
    Then no tab with title "SearchableRenamed" should be open
    When I open the sidebar request "SearchableRenamed"
    Then a request tab for "SearchableRenamed" should be open
    When I focus the "SearchableRenamed" tab
    Then the active request tab should show the "http" environment

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

    When I close the app
    Then the saved main window bounds should be x=120 y=80 width=1200 height=800
    And no errors should have been logged
