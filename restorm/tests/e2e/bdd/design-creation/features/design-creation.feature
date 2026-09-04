Feature: Design creation entry points
  Two doors into designing (free on every plan — the plan gates RUNNING
  a design): the EmptyBench "Create an API design" button starts a
  blank design in the open project, and a documented env folder's
  context menu derives a PRE-FILLED design from its imported
  documentation, created INSIDE the folder so it resolves the folder's
  variables like a request does.

  Scenario: Create a blank design from the EmptyBench
    Given a Pro project with a documented env folder is open
    When I click the EmptyBench create-design button
    Then a design tab named "New API design" is open
    And the sidebar carries a design node named "New API design"
    When I save the project
    Then the saved file carries a design named "New API design"

  Scenario: A documented env folder derives a pre-filled design
    Given a Pro project with a documented env folder is open
    When I create a design from the env folder's context menu
    Then a design tab named "Petstore design project design" is open
    When I open the models section of the open design
    Then the models list of the open design offers "Pet"
    And the enums list of the open design offers "PetStatus"
    When I open the routes section of the open design
    Then the routes tree shows the group "pets" with 2 routes
    When I save the project
    Then the saved file nests the derived design inside the env folder

  Scenario: A design inside an env folder resolves variables per the picked environment
    Given a Pro project with a documented env folder is open
    When I create a design from the env folder's context menu
    Then the resolved base line reads "https://dev.example.com/v2"
    When I pick the design environment "Prod"
    Then the resolved base line reads "https://prod.example.com/v2"
