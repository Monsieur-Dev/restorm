Feature: Background API-design validation surfaces problems in imported APIs
  After importing an API, Restorm quietly projects it into a design and runs the
  same validation the API designer applies. A flawed API is flagged with a "!"
  on its env-folder sidebar row, and its workbench gains an "Issues" tab listing
  exactly what was found. A clean API shows neither.

  Scenario: Importing a flawed spec flags the API and opens an Issues tab
    Given a new single-file YAML collection
    When I import the deliberately flawed OpenAPI spec
    Then the sidebar should contain an environment folder named "Design Issues API"
    And the environment folder "Design Issues API" should show a design-issues indicator
    And opening the environment folder "Design Issues API" reveals an "Issues" tab
    And the Issues tab lists at least 3 design problems

  Scenario: Importing a clean spec shows no indicator and no Issues tab
    Given a new single-file YAML collection
    When I import the OpenAPI 3.0 Petstore spec
    Then the sidebar should contain an environment folder named "Petstore"
    And the environment folder "Petstore" should not show a design-issues indicator
    And opening the environment folder "Petstore" shows no "Issues" tab
