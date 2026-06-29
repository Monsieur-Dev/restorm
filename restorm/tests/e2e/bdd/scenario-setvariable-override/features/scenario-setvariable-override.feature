Feature: Scenario setVariable overrides an env-folder variable for a downstream request

  An environment folder declares `petId` and a request ("Find pet by ID") uses
  it in its URL `{{baseUrl}}/pet/{{petId}}`. In a scenario, a `setVariable petId`
  placed BEFORE the request action must win: the request runs with the
  setVariable value, NOT the env-folder value. Verified against the live petstore
  mock — the run resolves to /pet/<setVariable> and returns that pet.

  Scenario: a setVariable before the request overrides the env-folder petId
    Given I open the setVariable-override sample
    When I run the "setVariable override" scenario and copy all its logs
    Then the setVariable run-log matches the snapshot
