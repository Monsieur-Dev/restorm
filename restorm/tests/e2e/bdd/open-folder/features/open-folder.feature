Feature: Open Folder
  As a user, I want to open a folder containing Restorm files
  so that I can work with multiple collections.

  Background:
    Given system modals mocking is installed

  Scenario: Should load 9 environment folders from Petstore folder
    Given I configure the open folder dialog to return path "tests/e2e/samples/Petstore"
    When I request opening a folder
    Then an open dialog should have been shown
    And the folder is loaded
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
    Given I configure the open folder dialog to return path "tests/e2e/samples/Petstore"
    When I request opening a folder
    Then an open dialog should have been shown
    And the folder is loaded
    Then I should see "Swagger Petstore" folder
    And I should see "GraphQL Docker" folder
    And I should see "AsyncAPI Petstore" folder

