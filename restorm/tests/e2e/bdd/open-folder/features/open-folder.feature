Feature: Open Folder
  As a user, I want to open a folder containing Restorm files
  so that I can work with multiple collections.

  Scenario: Should load 9 environment folders from Petstore folder
    Given the folder is loaded
    Then I should see "Swagger Petstore" folder
    And I should see "GraphQL Docker" folder
    And I should see "GraphQL Petstore" folder
    And I should see "gRPC Docker" folder
    And I should see "gRPC Petstore" folder
    And I should see "SOAP Docker" folder
    And I should see "SOAP Petstore" folder
    And I should see "AsyncAPI Docker" folder
    And I should see "AsyncAPI Petstore" folder
    And I should see exactly 9 folders

  Scenario: Should display folders in correct order
    Given the folder is loaded
    Then I should see "Swagger Petstore" folder
    And I should see "GraphQL Docker" folder
    And I should see "AsyncAPI Petstore" folder

