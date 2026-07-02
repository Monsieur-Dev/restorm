Feature: HTTPie import — Desktop collections + CLI sessions

  Both HTTPie export shapes are auto-detected from content alone (no format
  picker): a Desktop collection JSON routes to the folder-tree importer, a
  CLI session JSON routes to the environment-only importer.

  Scenario: Import an HTTPie Desktop collection and run the imported request
    Given a new single-file collection for HTTPie import
    When I import the HTTPie Desktop collection
    Then the sidebar should contain an environment folder named "Petstore"
    When I open the request "Get pet" and send it
    Then the response status should be 200

  Scenario: Import an HTTPie CLI session as an environment carrying its persistent state
    Given a new single-file collection for HTTPie import
    When I import the HTTPie CLI session
    Then the sidebar should contain an environment folder named "HTTPie Session"
    And the saved collection should carry the session variable "X-Api-Key" with value "sk_test_12345"
