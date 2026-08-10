Feature: Sidebar multi-selection and drag & drop overhaul
  The workspace tree supports multi-selection (ctrl+click toggle, shift+click
  range) and a reworked drag & drop: a multi-item drag moves the whole
  selection, containers accept drops at their end, an incoherent move (a
  folder into its own subtree, an environment folder anywhere inside another
  environment folder or a scenario) is refused, root-level items can finally
  be moved (rows and the empty area alike), a collapsed container hovered
  mid-drag expands after a second, and a requests-only selection dropped on
  an open scenario's canvas lands as sequentially-offset actions.

  Every scenario starts from a deterministic collapsed baseline: a fresh
  project's initial expansion is racy (persisted-state default), so the
  suite collapses everything first and re-expands through the chevrons.

  Scenario: Ctrl+click builds a multi-selection
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I expand the sidebar row "Auth Service"
    And I expand the sidebar row "Pet API"
    When I click the sidebar row "Health"
    And I ctrl-click the sidebar row "Get Pet by Id"
    Then the sidebar rows "Health" and "Get Pet by Id" should both be selected

  Scenario: Dropping a multi-selection on a folder moves every item to its end
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I expand the sidebar row "Auth Service"
    And I expand the sidebar row "Pet API"
    When I click the sidebar row "Health"
    And I ctrl-click the sidebar row "Get Pet by Id"
    And I drag the sidebar selection onto the middle of row "e2e utilities"
    And I expand the sidebar row "e2e utilities"
    Then the folder "e2e utilities" should list "Health" then "Get Pet by Id" as its last children

  Scenario: A root item can be moved (reordered below a new root sibling)
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I create a root environment folder from the empty-area menu
    Then the first sidebar root row should be "Auth Service"
    When I drag the sidebar row "Auth Service" below the last root row
    Then the last sidebar root row should be "Auth Service"

  Scenario: Dropping a container into its own subtree is refused
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I expand the sidebar row "Auth Service"
    When I drag the sidebar row "Auth Service" onto the middle of row "Pet API"
    Then the sidebar row "Auth Service" should still be a root row
    And the folder "Pet API" should not contain "Auth Service"

  Scenario: An environment folder can never land inside another environment folder or a scenario
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I create a root environment folder from the empty-area menu
    And I expand the sidebar row "Auth Service"
    And I expand the sidebar row "Pet API"
    When I drag the sidebar row "New Environment Folder" onto the middle of row "Auth Service"
    Then the sidebar row "New Environment Folder" should still be a root row
    When I drag the sidebar row "New Environment Folder" onto the middle of row "Pet API"
    Then the sidebar row "New Environment Folder" should still be a root row
    When I drag the sidebar row "New Environment Folder" onto the middle of row "Main"
    Then the sidebar row "New Environment Folder" should still be a root row

  Scenario: A collapsed container hovered during a drag expands after a second
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I expand the sidebar row "Auth Service"
    And I expand the sidebar row "Pet API"
    When I start dragging the sidebar row "Health"
    And I hover the drag over the row "e2e utilities" for 1.5 seconds
    Then the sidebar row "e2e utilities" should be expanded

  Scenario: Dropping on the empty area moves the item to the root — without expanding the last folder
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I expand the sidebar row "Auth Service"
    And I expand the sidebar row "Pet API"
    When I start dragging the sidebar row "Health"
    And I hover the drag over the row "e2e utilities" for 0.3 seconds
    And I hover the drag over the sidebar empty area for 1.2 seconds
    Then the sidebar row "e2e utilities" should still be collapsed
    When I drop the drag on the sidebar empty area
    Then the last sidebar root row should be "Health"

  Scenario: A requests-only selection dropped on a scenario canvas lands as offset actions
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I expand the sidebar row "Auth Service"
    And I expand the sidebar row "Pet API"
    And I open the scenario "Main" as a workbench tab
    And I count the scenario graph nodes
    When I click the sidebar row "Health"
    And I ctrl-click the sidebar row "Get Pet by Id"
    And I activate the workbench tab "Main"
    And I drag the sidebar selection onto the scenario canvas
    Then the scenario graph should have 2 more nodes
    And the two newest actions should be offset by the duplication step
    And every scenario action is capped at the maximum box width

  Scenario: A multi-item drag never lights the workbench split overlay
    Given the sidebar-dnd reference project is open
    And I collapse all sidebar rows
    And I expand the sidebar row "Auth Service"
    And I expand the sidebar row "Pet API"
    And I open the request "Health" as a workbench tab
    When I click the sidebar row "Health"
    And I ctrl-click the sidebar row "Get Pet by Id"
    And I drag the sidebar selection over the workbench surface
    Then no workbench drop overlay should be visible
