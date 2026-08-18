Feature: Design code generation
  The Code section turns a design into a project through a sandboxed
  Copier-format template run: source picked (local folder here — zero
  network), output folder chosen through the system dialog, generation
  previewed, and written to disk only after confirmation. An invalid
  design cannot generate; Community sees the gate.

  Scenario: A local template generates, previews and extracts
    Given restorm is launched with MCP for codegen work
    When the agent authors a valid "Codegen API" design
    And the design tab is opened on the code section
    And the local fixture template is added
    And the output folder is picked through the system dialog
    And the generation is launched
    Then the preview lists the generated files
    When the generated tree is confirmed
    Then the rendered project sits in the output folder

  Scenario: An agent generates through MCP with preview then confirm
    Given restorm is launched with MCP for codegen work
    When the agent authors a valid "Agent Codegen API" design
    And the agent requests a generation preview over MCP
    Then the MCP reply carries the preview without writing anything
    When the agent confirms the generation over MCP
    Then the rendered project sits in the output folder

  Scenario: The PostgreSQL template derives the SQL trio from the design
    Given restorm is launched with MCP for codegen work
    When the agent authors a valid "Db Codegen API" design
    And the agent generates with the local postgres template over MCP
    Then the SQL trio sits in the output folder and carries the design

  Scenario: A hostile template is refused cleanly
    Given restorm is launched with MCP for codegen work
    When the agent authors a valid "Hostile Codegen API" design
    And the agent generates with the hostile template over MCP
    Then the generation is refused as a template error and nothing is written

  Scenario: An invalid design cannot generate
    Given restorm is launched with MCP for codegen work
    When the agent authors a "Broken API" design with a duplicate route
    And the design tab is opened on the code section
    And the local fixture template is added
    Then the generate button is disabled with the validation explanation

  Scenario: Community sees the generation gate
    Given restorm is launched with MCP for codegen work without a plan
    When the agent authors a valid "Community API" design
    And the design tab is opened on the code section
    And the local fixture template is added
    Then the generate control is plan-gated
