Feature: Git collaboration between two live restorm instances

  One evolving scenario, two simultaneous restorm instances (one per user),
  a single shared remote that starts EMPTY. Every git surface is asserted
  on BOTH indicators: the statusbar pastilles AND the Git menu pastilles.

  Scenario: Yoann and Claude share a petstore project through one remote
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" launches restorm

    # ── Chapter 1 — Yoann creates, imports, publishes ──────────────────
    When "Yoann" creates the project file "petstore.restorm" in his repository
    And "Yoann" imports the Petstore from "http://localhost:8080/api/swagger.json"
    Then "Yoann" sees 1 environment folder, 3 folders and 20 requests in the sidebar
    And "Yoann" sees the push flag ON and the pull flag OFF
    When "Yoann" pushes his changes
    Then "Yoann" sees 1 commit in the history, the last by "yoann@restorm.app" mentioning "20 requests"
    And "Yoann" sees the push flag OFF and the pull flag OFF

    # ── Chapter 2 — Claude clones and opens the same project ──────────
    When "Claude" clones the remote into his workspace
    And "Claude" launches restorm
    And "Claude" opens the project file "petstore.restorm" from his workspace
    Then "Claude" sees 1 environment folder, 3 folders and 20 requests in the sidebar

    # ── Chapter 3 — Yoann edits petId, reverts, unchecks redirects ────
    When "Yoann" opens the request "Find pet by ID"
    And "Yoann" sets the path parameter value to "1"
    Then "Yoann" sees the push flag ON and the pull flag OFF
    When "Yoann" sets the path parameter value to "0"
    Then "Yoann" sees the push flag OFF and the pull flag OFF
    When "Yoann" turns off the follow redirects option
    Then "Yoann" sees the push flag ON and the pull flag OFF
    When "Yoann" pushes his changes
    Then "Yoann" sees 2 commits in the history, the last by "yoann@restorm.app" mentioning "Find pet by ID"
    And "Yoann" sees the push flag OFF and the pull flag OFF

    # ── Chapter 4 — Claude refreshes, pulls, sees the update live ─────
    When "Claude" opens the request "Find pet by ID"
    Then "Claude" sees the follow redirects option checked in the open request
    When "Claude" refreshes the git state
    Then "Claude" sees the push flag OFF and the pull flag ON
    When "Claude" pulls the changes
    Then "Claude" sees the push flag OFF and the pull flag OFF
    And "Claude" sees the follow redirects option unchecked in the open request
    And "Claude" sees 2 commits in the history, the last by "yoann@restorm.app" mentioning "Find pet by ID"

  Scenario: Request option edits instantly mark the project dirty (reactivity)
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed multi-protocol project "reactivity.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "reactivity.restorm" from his workspace
    # Opening a hand-authored file rewrites it in the app's canonical
    # serialization — publish that normalization echo once, so every
    # protocol case below starts from a genuinely clean tree.
    Then "Yoann" sees the push flag ON and the pull flag OFF
    When "Yoann" pushes his changes
    Then "Yoann" sees the push flag OFF and the pull flag OFF

    # Kafka — a type the reactive layer must track end to end
    When "Yoann" opens the request "Kafka sample"
    And "Yoann" toggles the kafka TLS option
    Then "Yoann" sees the push flag ON and the pull flag OFF
    When "Yoann" pushes his changes
    Then "Yoann" sees the push flag OFF and the pull flag OFF

    # MQTT options live on the websocket request type
    When "Yoann" opens the request "MQTT sample"
    And "Yoann" toggles the MQTT subscribe option
    Then "Yoann" sees the push flag ON and the pull flag OFF
    When "Yoann" pushes his changes
    Then "Yoann" sees the push flag OFF and the pull flag OFF

    # HTTP execution options (timeout field)
    When "Yoann" opens the request "HTTP sample"
    And "Yoann" sets the request timeout to "5000"
    Then "Yoann" sees the push flag ON and the pull flag OFF

  Scenario: Being behind the server is handled before anything is committed
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed multi-protocol project "shared.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "shared.restorm" from his workspace
    Then "Yoann" sees the push flag ON and the pull flag OFF
    When "Yoann" pushes his changes
    # The premise of everything below: the colleague must branch from THIS
    # state, not from the hand-authored seed. Asserted against git, because
    # a push that silently fails leaves the whole scenario meaningless.
    Then "Yoann" has nothing left to publish
    And "Yoann" sees the push flag OFF and the pull flag OFF

    # ── Behind, nothing contested → no prompt at all ──────────────────
    # The colleague edits one request, Yoann another. Entity-level there
    # is no disagreement, so asking him anything would be ceremony.
    When a colleague pushes a change to "shared.restorm" replacing "Kafka sample" with "Kafka renamed by colleague"
    And "Yoann" opens the request "MQTT sample"
    And "Yoann" toggles the MQTT subscribe option
    And "Yoann" pushes his changes
    Then "Yoann" sees no update prompt
    And "Yoann" sees the push flag OFF and the pull flag OFF
    And "Yoann" sees the request "Kafka renamed by colleague" in the sidebar

    # ── Behind, contested → prompt, and NOTHING committed ─────────────
    When a colleague pushes a change to "shared.restorm" replacing "https://example.com/ping" with "https://colleague.example/ping"
    And "Yoann" opens the request "HTTP sample"
    And "Yoann" sets the request timeout to "4242"
    And "Yoann" pushes his changes
    Then "Yoann" sees the update prompt reporting 1 conflicting item
    And "Yoann" has no new local commit

    # ── Cancel is strictly inert ──────────────────────────────────────
    When "Yoann" cancels the update prompt
    Then "Yoann" has no new local commit
    And "Yoann" sees the push flag ON and the pull flag ON

    # ── Keep my version → my edit survives and is published ───────────
    When "Yoann" pushes his changes
    And "Yoann" chooses to keep his version in the update prompt
    Then "Yoann" sees the push flag OFF and the pull flag OFF
    And "Yoann" sees the request timeout is "4242"

  Scenario: Resetting to the server version discards local work on demand
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed multi-protocol project "reset.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "reset.restorm" from his workspace
    And "Yoann" pushes his changes
    Then "Yoann" has nothing left to publish
    And "Yoann" sees the push flag OFF and the pull flag OFF

    When "Yoann" opens the request "HTTP sample"
    And "Yoann" sets the request timeout to "9999"
    Then "Yoann" sees the push flag ON and the pull flag OFF
    When "Yoann" resets to the server version from the Git menu
    Then "Yoann" sees the push flag OFF and the pull flag OFF
    And "Yoann" sees the request timeout is ""

  Scenario: A saved quick setting is arbitrated on its own
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed multi-protocol project "quicksettings.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "quicksettings.restorm" from his workspace
    And "Yoann" pushes his changes
    Then "Yoann" has nothing left to publish

    # Both sides change the SAME saved configuration, differently. The
    # request itself is untouched — only its quick setting is contested.
    # The colleague moves BOTH the request itself and its saved
    # configuration; Yoann moves both too, differently. Two contested
    # things, so the conflict list is shown (it is skipped for a single
    # one) and each is arbitrated separately.
    When a colleague pushes a change to "quicksettings.restorm" replacing "https://staging.example/ping" with "https://colleague-staging.example/ping"
    And a colleague pushes a change to "quicksettings.restorm" replacing "https://example.com/ping" with "https://colleague.example/ping"
    And "Yoann" opens the request "HTTP sample"
    And "Yoann" sets the request timeout to "7777"
    And "Yoann" saves the quick setting named "Staging"
    And "Yoann" pushes his changes
    Then "Yoann" sees the update prompt reporting 2 conflicting items

    When "Yoann" opens the conflict resolution from the update prompt
    # Both rows are the same request; only the composed label tells them
    # apart, which is exactly why the saved configuration's name is in it.
    Then "Yoann" sees the conflict entry "HTTP sample - Staging"
    When "Yoann" selects the conflict entry "HTTP sample - Staging"
    Then "Yoann" sees the conflict is announced on the quick setting "Staging"
    When "Yoann" keeps the server version of the selected conflict
    And "Yoann" selects the conflict entry "HTTP sample"
    And "Yoann" keeps the server version of the selected conflict
    And "Yoann" finishes the conflict resolution
    Then "Yoann" has nothing left to publish

  Scenario: A contested rename is arbitrated like any other field
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed multi-protocol project "renames.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "renames.restorm" from his workspace
    And "Yoann" pushes his changes
    Then "Yoann" has nothing left to publish

    # Both sides rename the SAME request, differently — nothing else about
    # it changes. Before the name became a diffable field this listed a
    # conflict whose three panels showed nothing at all to arbitrate.
    When a colleague pushes a change to "renames.restorm" replacing "name: HTTP sample" with "name: Fetch a pet"
    And "Yoann" renames the request "HTTP sample" to "Find pet by ID"
    And "Yoann" pushes his changes
    Then "Yoann" sees the update prompt reporting 1 conflicting item

    When "Yoann" opens the conflict resolution from the update prompt
    Then "Yoann" sees the name "Find pet by ID" on the user side
    And "Yoann" sees the name "Fetch a pet" on the server side
    And "Yoann" cannot edit the name on the user side

    # The resolved column takes a third name: the arbitration is not
    # limited to picking one of the two sides.
    When "Yoann" keeps the server version of the selected conflict
    And "Yoann" types "Find a pet by its ID" as the resolved name
    And "Yoann" finishes the conflict resolution
    Then "Yoann" has nothing left to publish
    And "Yoann" has 1 request named "Find a pet by its ID" in "renames.restorm" on disk
    And "Yoann" has 1 request named "Reactivity Lab" in "renames.restorm" on disk
    And "Yoann" sees the request "Find a pet by its ID" in his sidebar

  Scenario: A deletion nobody contested is honoured, one that races an edit is not
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed multi-protocol project "deletions.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "deletions.restorm" from his workspace
    And "Yoann" pushes his changes
    Then "Yoann" has nothing left to publish

    # The colleague removes one request and edits another. Yoann leaves the
    # removed one alone, so that deletion has an obvious answer; he edits
    # the second, which is what makes the colleague's edit of it contested.
    When a colleague deletes the request "MQTT sample" from "deletions.restorm"
    And "Yoann" opens the request "HTTP sample"
    And "Yoann" sets the request timeout to "4242"
    And "Yoann" pulls
    # The uncontested deletion propagates: keeping it would silently undo
    # ordinary housekeeping.
    Then "Yoann" does not see the request "MQTT sample" in his sidebar
    And "Yoann" sees the request "HTTP sample" in his sidebar

  Scenario: When only the tags diverge, the tag tab is the whole conflict view
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed multi-protocol project "tags.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "tags.restorm" from his workspace
    And "Yoann" pushes his changes
    Then "Yoann" has nothing left to publish

    # Both sides tag the SAME request differently and touch nothing else, so
    # the tag tab must be the only thing the view offers.
    When a colleague tags the request "HTTP sample" with "serveur" in "tags.restorm"
    And "Yoann" opens the request "HTTP sample"
    And "Yoann" tags the open request with "poste"
    And "Yoann" pushes his changes
    Then "Yoann" sees the update prompt reporting 1 conflicting item

    When "Yoann" opens the conflict resolution from the update prompt
    Then "Yoann" sees the tags tab as the only tab
    And "Yoann" sees the tag "poste" on the user side
    And "Yoann" sees the tag "serveur" on the server side
    When "Yoann" keeps the server version of the selected conflict
    And "Yoann" finishes the conflict resolution
    Then "Yoann" has nothing left to publish

  Scenario: Two conflicting moves are arbitrated as one tree-structure entry
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed two-folder project "tree.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "tree.restorm" from his workspace
    And "Yoann" pushes his changes
    Then "Yoann" has nothing left to publish

    # Both sides move the SAME request to a different folder. Where an item
    # lives is a property of the hierarchy, so it is arbitrated once, as a
    # whole — not item by item.
    When a colleague moves the request "Fiche animal" into the folder "Dossier B" in "tree.restorm"
    And "Yoann" moves the request "Fiche animal" into the folder "Dossier C"
    And "Yoann" pushes his changes
    Then "Yoann" sees the update prompt reporting 1 conflicting item

    When "Yoann" opens the conflict resolution from the update prompt
    Then "Yoann" sees the tree-structure conflict listing "Fiche animal" as moved
    When "Yoann" keeps the server version of the selected conflict
    And "Yoann" finishes the conflict resolution
    Then "Yoann" has nothing left to publish

  Scenario: A branch checked out from a terminal is not silently overwritten
    Given an empty shared git remote
    And "Yoann" has a local repository connected to the remote
    And "Yoann" has a committed two-folder project "branche.restorm"
    And "Yoann" launches restorm
    When "Yoann" opens the project file "branche.restorm" from his workspace
    And "Yoann" opens the request "Fiche animal"

    # The app holds the project in memory and autosaves about a second after
    # any edit, so a branch checked out from a terminal used to be undone on
    # disk without a word. The save must be refused and the choice offered.
    When the branch "autre-branche" renaming "Fiche animal" to "Fiche autre branche" is checked out from a terminal in "branche.restorm"
    And "Yoann" will answer "reload" to the file-changed-on-disk question
    And "Yoann" turns off the follow redirects option
    And "Yoann" saves his project
    # Seeing the other branch's tree IS the proof of the whole chain: the
    # save was refused, the question was raised, the mock answered
    # "reload", and the app re-hydrated from disk. Without any one of
    # those the sidebar would still show the pre-checkout name.
    Then "Yoann" sees the request "Fiche autre branche" in his sidebar
