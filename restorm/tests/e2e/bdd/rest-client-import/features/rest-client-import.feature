Feature: REST Client (.http) import

  Scenario: Importing a .http file produces one request per ### block
    Given a new single-file YAML collection
    When I import the REST Client sample file
    Then the sidebar should contain an environment folder named "REST Client Imports"
    And the environment folder "REST Client Imports" should expose a request named "Get users"
    And the environment folder "REST Client Imports" should expose a request named "createUser"
