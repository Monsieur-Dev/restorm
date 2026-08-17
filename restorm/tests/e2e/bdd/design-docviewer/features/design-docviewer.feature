Feature: Design documentation viewer
  The design's Documentation section serves the SAME readable view an
  imported API gets — the shared DocumentationHost fed by the design's
  live projection — plus per-entity edit links jumping back to the
  editable cards (the doc stays the readable surface, editing lives in
  the design cards).

  Scenario: The design renders through the shared documentation viewer
    Given a project carrying an API design is open on its documentation
    Then the documentation host renders the design's routes and models

  Scenario: The documentation reflects design edits live
    Given a project carrying an API design is open on its documentation
    When I rename the "User" model to "Customer" from the models section
    And I return to the documentation section
    Then the documentation host renders a model named "Customer"

  Scenario: Edit links jump to the editable cards
    Given a project carrying an API design is open on its documentation
    When I click the edit link of the "User" model in the documentation
    Then the models section opens on the "User" model card
    When I return to the documentation section
    And I click the edit link of the "getUser" route in the documentation
    Then the routes section opens on a route card
