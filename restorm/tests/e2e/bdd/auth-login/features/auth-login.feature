Feature: Authentication routes end-to-end
  Covers the wiring between the AuthenticationCacheService, the HTTP
  execution pipeline and the in-repo `auth-service` Docker container.
  The service publishes:

    • POST /login          → gated; { client_id: VALID|INVALID } → Bearer or 401
    • GET  /releaselogins  → unblocks every pending /login call at once
    • GET  /pet/{id}       → Bearer-gated static payload
    • GET  /swagger.json   → Bearer-gated pet-only OpenAPI document
    • GET  /health         → liveness probe

  Test-only (raw HTTP from the step code, never via the sidebar):
    • POST /cleartokens    → empties the issued-token store
    • POST /clear_logs     → empties the in-memory request log
    • GET  /getlogs        → snapshot of the request log

  The gate on /login is what makes the inflight-coalescing behaviour
  observable: N concurrent downstream requests should issue ONE /login,
  and a single /releaselogins must unblock all of them.

  Scenario: Sample loads with auth and pet-API routes in the sidebar
    Given I open the auth-login sample collection
    Then the sidebar should show the "Login" auth request
    And the sidebar should show the "Pet API" folder
    And the sidebar should show the "Get Pet by Id" request under "Pet API"

  Scenario: Import the pet swagger — attach login to lift the 401 preview
    Given the auth service logs and tokens are cleared
    And I create a new empty restorm file
    When I open the import modal and paste the pet swagger URL
    Then the import modal should show a 401 error
    When I click the "Add an authentication route" button
    And I configure the login request with the valid client id
    And I send the inline authentication request
    Then the authentication Configuration tab should show an expiration expression
    And the authentication Configuration tab should carry an Authorization produced header
    When I confirm the authentication setup
    Then the import modal preview should let me deselect the inventory route

    When I import the previewed routes
    And I rename the imported environment to "Valid environnement"
    And I add a "client_id" variable with value "VALID_CLIENT_ID"
    And I add a sub-environment "invalid environnement" with "client_id" set to "INVALID_CLIENT_ID"
    And I switch the imported authentication body client_id to the expression "{{client_id}}"
    And I open the pet request in a tab
    # Importing the auth route into the pet request's env folder makes the
    # tab-header key APPEAR on the already-open request (reactive — it had
    # none before the import), attached to the imported route.
    Then the tab-header auth key should show a route attached
    When I send the pet request twice
    # The chosen auth route is actually CALLED — the gate'd pet payload only
    # returns once the Bearer from the auth route is applied.
    Then the pet response body should contain "Rex"
    # The auth (login) call the pet request triggered must be recorded in the
    # auth route's OWN response history — same store a user-sent request lands
    # in — so the login call is visible in the route's history panel.
    And the "Authentication route" auth route history should contain the auth call

    # Tab-header auth selector is an icon-only key button. Opening it lists
    # the available auth route; picking an option writes the active request's
    # attached route, CLOSES the popover, flips the key to its pressed/active
    # state, and updates the hover tooltip — all LIVE (no tab reopen).
    # Detaching then re-attaching round-trips the choice through the reactive
    # state.
    When I open the tab-header auth selector
    Then the tab-header auth selector popover should list the "Authentication route" route
    When I pick "No auth" in the tab-header auth selector
    Then the tab-header auth selector popover should close
    And the tab-header auth key should show no auth attached
    And the tab-header auth tooltip should read "No auth"
    When I open the tab-header auth selector
    And I pick the "Authentication route" route in the tab-header auth selector
    Then the tab-header auth selector popover should close
    And the tab-header auth key should show a route attached
    # The pointer is still over the key right after the pick, but the hover
    # tooltip must NOT pop as a side effect of selecting.
    And the tab-header auth tooltip should not be showing
    And the tab-header auth tooltip should read "Authentication route"

    # Per-tab env pinning regression: pet on "Valid environnement",
    # auth route on "invalid environnement". The auth-resolver should
    # inherit the calling request's env (Valid) when sending the pet
    # request, because "Valid environnement" is also visible to the
    # auth route — the auth's own pinned env is overridden by the
    # parent's. Without this rule the auth would resolve `client_id`
    # against `INVALID_CLIENT_ID` and the gate'd reject the login.
    When I focus the "Authentication route" request tab
    And I select the "invalid environnement" environment for the active tab without apply-to-all
    When I focus the "Find pet by ID" request tab
    And I select the "Valid environnement" environment for the active tab without apply-to-all

    When I clear the issued tokens
    And I re-send the pet request
    Then the tab-header auth indicator should show the running feedback
    When I release the pending login
    Then the pet response body should still contain "Rex"

    When I trigger a refresh from source on the imported folder
    Then the refresh import modal should show the inventory route as unchecked
    And the refresh import modal should show the existing pet route as checked and disabled
    When I tick the inventory route in the refresh import modal
    Then the apply update button should display the count "1"
    When I apply the refresh
    Then the sidebar should show the "Pet inventory" request

    When I switch the active environment to the "invalid environnement" sub-env with apply-to-all
    And I clear the issued tokens
    And I re-send the pet request
    And I release the pending login
    Then the pet response should fail with a 401
    And an authentication-failure toast should appear with a link to the auth route

    When I click the "Open authentication route" link in the toast
    Then the authentication route tab should become active
    And the authentication-failure toast should disappear
    When I send the authentication request directly
    And I release the pending login
    Then no authentication-failure toast should appear

    # Reactive disappearance: with the pet request focused its tab-header
    # key is shown; deleting the LAST in-scope auth route makes the key
    # vanish live (no reopen), since there is no route left to attach.
    When I focus the "Find pet by ID" request tab
    Then the tab-header auth key should show a route attached
    When I delete the "Authentication route" auth request from the sidebar
    Then the tab-header auth key should be hidden
