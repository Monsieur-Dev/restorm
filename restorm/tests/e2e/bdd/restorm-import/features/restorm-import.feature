Feature: Restorm project import — merge another .restorm into the open project
  Importing a `.restorm` file merges its collections into the currently-open
  project under one wrapping folder named after the source file. Every
  imported element gets a fresh identity and every internal reference
  follows, so nothing collides with the open project — not even when a
  project is imported into itself, which must yield a clean duplicate set
  alongside the originals, never a dedupe or an overwrite.

  Scenario: Importing a project file merges it under a wrapping folder
    Given a new single-file YAML collection for restorm import
    When I import the restorm fixture file "mini-project.restorm"
    Then the sidebar should show the imported folder "mini-project"
    And expanding "mini-project" should reveal "PetAPI"

  Scenario: Importing the open project into itself duplicates it cleanly
    Given a new single-file YAML collection for restorm import
    When I import the restorm fixture file "mini-project.restorm"
    And I save the project
    And I import the project's own file
    Then the sidebar should show the imported folder "restorm-import"
    And exactly 2 folders named "mini-project" should be in the sidebar
    When I save the project
    Then the saved project file should contain no duplicate document ids

  Scenario: The merge survives save and reopen
    Given a new single-file YAML collection for restorm import
    When I import the restorm fixture file "mini-project.restorm"
    And I save the project
    And I reopen the project from disk
    Then the sidebar should show the imported folder "mini-project"
    And expanding "mini-project" should reveal "PetAPI"
