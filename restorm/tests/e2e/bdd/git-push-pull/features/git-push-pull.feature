Feature: Git push and pull
  The atomic commit+push flow (status-bar button → Push modal → Push) and a
  clean pull (no conflicts). Opt out with SKIP_GIT_E2E=1 on a host that
  cannot run the git-server docker mock.

  Scenario: Pushing a local change lands on the remote
    Given I open a project cloned from a freshly seeded git remote
    When I change the request's URL and push
    Then the remote has the pushed change

  Scenario: Pulling with no conflicts fetches the latest remote change
    Given another collaborator has pushed a change to a freshly seeded git remote
    And I open my own clone of that same remote
    When I pull
    Then the collaborator's change is visible
