Feature: Design search indexing
  The global search (minisearch) indexes designs: the design itself and
  its models / enums / routes (names + descriptions), grouped under a
  dedicated design category. A result re-opens the Design tab
  positioned on the matching card, and edits reindex — no phantom hits.

  Scenario: Design entities surface as typed results
    Given a project carrying an API design is open for searching
    When I search the titlebar for "AdminUser"
    Then the design category lists a result named "AdminUser"
    When I search the titlebar for "Fetch one user"
    Then the design category lists a result named "Fetch one user"
    When I search the titlebar for "UserStatus"
    Then the design category lists a result named "UserStatus"

  Scenario: A description-only term finds its route
    Given a project carrying an API design is open for searching
    When I search the titlebar for "identifier"
    Then the design category lists a result named "Fetch one user"

  Scenario: Selecting a model result opens the Design tab on its card
    Given a project carrying an API design is open for searching
    When I search the titlebar for "AdminUser"
    And I click the design search result named "AdminUser"
    Then the models section opens on the "AdminUser" model card

  Scenario: A rename reindexes without phantom results
    Given a project carrying an API design is open for searching
    When I rename the "User" model to "Customer" from the models section
    And I search the titlebar for "Customer"
    Then the design category lists a result named "Customer"
