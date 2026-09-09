Feature: The Design tab shell
  A design opens in ONE workbench tab. Its sidebar node expands into
  GROUP entries only (one per section, never one row per model); opening
  a group refocuses the same tab on that section, the internal icon rail
  switches sections, the smartbar star favourites the design, and its
  virtual sub-entries never drag. Editing AND generating code are free on
  every plan — the plan gates SERVING the design as a mock, not designing
  it or generating from it.

  Scenario: One tab per design, refocused on the section a group entry names
    Given a Pro project carrying an API design is open
    When I click the design row in the sidebar
    Then the design tab is open on the "settings" section
    When I expand the design node
    And I click the design group entry "routes"
    Then the design tab is open on the "routes" section
    And exactly one design tab is open
    When I click the design group entry "models"
    Then the design tab is open on the "models" section
    And exactly one design tab is open

  Scenario: The section rows switch sections; entities live in the sidebar tree
    Given a Pro project carrying an API design is open
    When I click the design row in the sidebar
    Then the design tab is open on the "settings" section
    When I click the rail icon "models"
    Then the design tab is open on the "models" section
    And the "models" section lists "User"
    And the "models" section lists "Order"
    When I click the rail icon "enums"
    Then the design tab is open on the "enums" section
    And the "enums" section lists "UserStatus"
    When I click the rail icon "notes"
    Then the design tab is open on the "notes" section

  Scenario: A design's virtual sub-entries refuse drag and drop wholesale
    Given a Pro project carrying an API design is open
    When I expand the design node
    And I start dragging the design group entry "models"
    And I hover the drag over the env folder row
    Then the drop is refused
    And dropping there leaves the tree unchanged

  Scenario: The smartbar star favourites the design and reopens it from the pane
    Given a Pro project carrying an API design is open
    When I click the design row in the sidebar
    And I toggle the design favorite star
    Then the design appears in the favorites pane
    When I open the env folder tab
    And I click the design in the favorites pane
    Then the design tab is the active tab

  Scenario: Community designs freely — no edit gate on the tab
    Given a Community project carrying an API design is open
    When I click the design row in the sidebar
    Then the design settings are editable
    And the design serve spin is plan-gated
    Given a Pro project carrying an API design is open
    When I click the design row in the sidebar
    Then the design settings are editable

  Scenario: The context menu opens the design in a split panel
    Given a Pro project carrying an API design is open
    When I open the env folder tab
    And I open the design in a split panel from its context menu
    Then two workbench groups are visible
    And the design tab is open on the "settings" section
