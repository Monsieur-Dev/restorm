Feature: Design MCP exposure
  An agent designs a whole API over MCP — models, enums, examples,
  generated CRUD — then serves it and calls it through Restorm
  requests, without ever touching the UI. Editing is free on every
  plan (like the UI); serving is the gated half. MCP writes never
  clobber unsaved UI edits.

  Scenario: An agent designs, serves and calls an API end to end
    Given restorm is launched with MCP for design work
    When the agent creates a design named "Agent API" on port 7484
    And the agent models a "User" with an identifier, a searchable email and a "Status" enum
    And the agent seeds a named example with email "admin@agent.io"
    And the agent generates CRUD routes for "User"
    Then the design reports no validation issues over MCP
    When the agent serves the design
    And the agent calls the served list route through a Restorm request
    Then the request response is 200 and carries "admin@agent.io"
    And the design server status reports served calls
    When the agent stops the design server
    Then the design server status reports it stopped

  Scenario: Community edits freely but cannot serve
    Given restorm is launched with MCP without a plan
    When the agent creates a design named "Community API" on port 7485
    Then the design creation succeeded
    When the agent tries to serve the design
    Then the serve call is refused as payment required

  Scenario: An unsaved UI edit survives an MCP design write
    Given restorm is launched with MCP for design work
    When the agent creates a design named "Coherence API" on port 7486
    And the design tab is opened with the title field edited to "Draft title"
    And the agent adds a "Colors" enum to the design over MCP
    Then the edited title field still shows "Draft title"

  Scenario: MCP serve and stop reflect in the UI
    Given restorm is launched with MCP for design work
    When the agent creates a design named "Reflected API" on port 7487
    And the agent serves the design
    And the design tab is opened
    Then the design spin button shows the serving state
    When the agent stops the design server
    Then the design spin button shows the idle state
