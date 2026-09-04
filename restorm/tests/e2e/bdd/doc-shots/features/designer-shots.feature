Feature: Designer documentation screenshots

  Capture localized, reproducible screenshots of the API designer for the
  website documentation. Runs only under the doc-shots gate
  (RESTORM_DOC_SHOTS=1), like the sibling doc-shots feature, and builds a
  representative design through the embedded MCP design tools.

  Scenario: Capture the API-designer views in every locale
    Given the app is running in documentation-capture mode
    And I am signed in with the demo account
    And I build the Petstore API design served on port 4010
    When I capture the models overview for every locale to "{locale}/designer-modeles.png"
    And I capture the models overview for every locale to "{locale}/designer-vue-ensemble.png"
    And I capture the designer section "routes" selecting "Find pet by ID" for every locale to "{locale}/designer-routes-crud.png"
    And I serve the design mock
    And I capture the designer section "server" for every locale to "{locale}/designer-mode-mock.png"
    And I capture the clients section for every locale to "{locale}/designer-clients.png"
    And I capture the designer section "code" for every locale to "{locale}/designer-generation-code.png"
    And I capture the general variables for every locale to "{locale}/designer-variables.png"
    And I capture the property code-generation tab for every locale to "{locale}/designer-contexte.png"
    And I capture the template library for every locale to "{locale}/designer-templates.png"
    Then I capture the designer home shot for every locale to "{locale}/designer.png"
