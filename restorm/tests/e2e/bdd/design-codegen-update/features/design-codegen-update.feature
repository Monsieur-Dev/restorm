Feature: Code generation update (3-way merge)

  Re-generating after the user has edited the generated code and the template
  has changed must fold the template's change in WITHOUT clobbering the user's
  edit — the `copier update` role.

  Scenario: Regeneration merges the template change and keeps the user's edit
    Given restorm is launched with MCP for codegen update
    And a design with the all-questions template pointed at a temp output
    When code is generated once
    And the user edits a generated file and the template is changed
    And code is generated again
    Then the regenerated file keeps the user edit and gains the template change
