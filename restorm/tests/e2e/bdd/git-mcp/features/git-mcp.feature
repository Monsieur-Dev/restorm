Feature: Git MCP routes

  Scenario: The 2-step commit+push flow reviews before writing anything, then commits and pushes on confirm
    Given a project cloned from a freshly seeded git remote, with an uncommitted change to the request's URL on disk, is open via MCP
    When I call git_commit_push over MCP
    Then it returns a review token and a generated commit title, with nothing committed yet
    When I call git_confirm_push with that review token over MCP
    Then the change is committed locally and pushed to the remote

  Scenario: A conflicted pull returns a resolution token, and resolving it lands the merge
    Given a remote has diverged on the request between my clone and a collaborator's
    And that project is open via MCP
    When I call git_pull over MCP
    Then it returns a resolution token and the conflict list, without completing the merge
    When I call git_resolve_conflicts picking my own version for every conflict over MCP
    Then the merge is committed locally with my version of the content
