Feature: API design reconstruction fidelity

  The MCP design-authoring tools must be able to rebuild a real design exactly.
  Reconstructing the RealEstate reference through them and comparing (ids and
  codegen templates aside) proves the tools cover every design construct.

  Scenario: The RealEstate design reconstructs identically through the MCP tools
    Given restorm is launched with MCP for design reconstruction
    When the agent reconstructs the RealEstate design from the golden
    Then the reconstructed design matches the golden except ids and templates
