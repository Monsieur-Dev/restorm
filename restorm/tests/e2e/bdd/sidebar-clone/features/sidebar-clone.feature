Feature: Sidebar Clone — recursive id independence
  Cloning any sidebar item must produce a fully independent copy: every
  id-bearing object in its subtree gets a fresh id, recursively, and every
  internal cross-reference (an edge endpoint, a runScenario node pointing at
  another scenario, a connectionNodeId pointing at another node) is remapped
  to follow the CLONE rather than dangling on the original. Renaming the
  ORIGINAL after cloning must never affect the clone — the sharpest,
  behavioural proof of id independence, since a clone that secretly shared
  an id with its source would change when the source is renamed. The
  titlebar search index must track both the clone and the (renamed)
  original as two distinct, separately-findable entities throughout.

  Background:
    Given I launch restorm with the MCP server enabled
    And I create a fresh project via MCP

  Scenario: Cloning a request is independent of the original, and both stay distinctly searchable after renaming the original
    Given I build a request "OriginalRequest" via MCP

    When I clone the sidebar item "OriginalRequest"
    Then the sidebar should contain the request "OriginalRequest (copy)"

    # Renaming the ORIGINAL must not touch the clone — the behavioural proof
    # of id independence (a clone that secretly aliased the original's id
    # would rename too).
    When I rename "OriginalRequest" to "OriginalRenamed" in the sidebar
    Then the sidebar should contain the request "OriginalRequest (copy)"
    And the sidebar should contain the request "OriginalRenamed"

    # The search index (a separate consumer from the tree) must show BOTH
    # as distinct entries: the clone still under its (never-renamed) name,
    # the original under its NEW name — never one merged/duplicate row, and
    # never the clone silently following the rename.
    When I save the file with Ctrl+S
    When I open the search bar
    And I search for "Original"
    Then the title-bar search results should contain hits mentioning "OriginalRequest (copy)" and "OriginalRenamed" as distinct entries
    When I close the search bar

  Scenario: Cloning a request gives its quick config a fresh id, owned by the clone rather than the original
    # A project-target quick config is stored directly on the Request object
    # (`QuickConfig[]`, keyed to its owner via `QuickConfig.requestId`) — it
    # rides along verbatim on `deepCloneItem`'s JSON round-trip, exactly like
    # any other id-bearing object in the subtree. So the clone must end up
    # with its OWN quick config: a fresh `QuickConfig.id` (not the
    # original's), with `requestId` remapped to point at the CLONE, not the
    # original — the same duplicate-id class this ticket fixes everywhere
    # else, not a "doesn't carry over" behaviour.
    Given I build a request "RequestWithQuickConfig" via MCP
    And I save a quick config named "Prod" on the request "RequestWithQuickConfig" via MCP

    When I clone the sidebar item "RequestWithQuickConfig"
    Then the sidebar should contain the request "RequestWithQuickConfig (copy)"
    And the cloned request "RequestWithQuickConfig (copy)" should have its own quick config "Prod", with a fresh id owned by the clone
    And the request "RequestWithQuickConfig" should still have its quick config "Prod"

  Scenario: Cloning an environment folder recursively refreshes every nested id, including a runScenario cross-reference and a connectionNodeId cross-reference — and renaming the original doesn't affect the clone
    # One root env-folder carrying every surface the recursive-clone-id
    # rule touches: an environment, a custom value list, an enum
    # definition, a nested folder + request, a Scenario "Caller" whose
    # runScenario node points at a sibling Scenario "Target" (the
    # config.scenarioId path), and a Scenario "SocketScenario" with a
    # socketioConnect/socketioClose pair (the config.connectionNodeId path —
    # 23 node kinds share this shape, all exercised the same way).
    #
    # The enum definition's id freshness on Clone is NOT independently
    # re-asserted here: no MCP tool or UI surface exposes an env-folder's
    # `enumDefinitions[]` for read-back (it's consumed internally for
    # autocomplete/documentation, never listed or renamed as its own
    # entity), so there is nothing to point an assertion at without adding
    # new introspection machinery. What this scenario DOES prove is that a
    # real Clone-through-the-UI, save-to-disk round trip with an enum
    # definition present neither crashes nor corrupts the tree — the id
    # invariant itself (fresh id, no collision with the source) is covered
    # by dedicated, mutation-verified unit tests in treeManipulation.test.ts.
    Given I build the recursive-clone fixture env-folder "Petshop" via MCP

    When I clone the sidebar item "Petshop"
    Then the sidebar should contain the folder "Petshop (copy)"

    # Renaming the ORIGINAL root must not affect the clone or anything
    # inside it — the same behavioural proof as the request scenario above,
    # now for a whole subtree cloned together.
    When I rename "Petshop" to "PetshopRenamed" in the sidebar
    Then the sidebar should contain the folder "Petshop (copy)"
    And the sidebar should contain the folder "PetshopRenamed"

    When I save the file with Ctrl+S
    When I open the search bar
    And I search for "Petshop"
    Then the title-bar search results should contain hits mentioning "Petshop (copy)" and "PetshopRenamed" as distinct entries
    When I close the search bar

    # Deep verification via MCP — the UI/search checks above prove the top-
    # level clone is independent and searchable; this proves EVERY nested
    # id inside it is too, and that the two cross-references (runScenario →
    # Target, connectionNodeId → the connect node) were remapped onto the
    # CLONE's own ids rather than left dangling on the original's.
    Then the cloned env-folder "Petshop (copy)" should be a fully independent, correctly cross-referenced copy of "PetshopRenamed"

    # The behavioural half of the connectionNodeId proof: alter the
    # ORIGINAL's connect node after cloning, then confirm the CLONE's close
    # node is unaffected — it never resolved through the original in the
    # first place, so nothing the original does afterward can touch it.
    When I alter the original's socketioConnect node via MCP
    Then the cloned scenario's socketioClose node should still resolve to the CLONE's own connect node, unaffected by that change
