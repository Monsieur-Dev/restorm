Feature: Import Requests
  As a user, I want to import requests from various sources
  so that I can quickly add collections to my workspace.

  Background:
    Given I have started the application
    And I have created a new empty file

  Scenario: Import preview from URL
    When I click the import button
    Then the import modal should be open
    When I paste "http://localhost:8080/api/swagger.json" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results

  Scenario: Import preview from file
    When I click the import button
    And I paste the path to "swagger-petstore.json" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results

  Scenario: Import preview from all test files
    When I click the import button
    # Test asyncapi-docker.yaml
    And I paste the path to "asyncapi-docker.yaml" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test asyncapi-petstore.yaml
    When I paste the path to "asyncapi-petstore.yaml" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test bruno-petstore.json
    When I paste the path to "bruno-petstore.json" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test graphql-docker.graphql
    When I paste the path to "graphql-docker.graphql" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test graphql-petstore.graphql
    When I paste the path to "graphql-petstore.graphql" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test grpc-docker.proto
    When I paste the path to "grpc-docker.proto" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test grpc-petstore.proto
    When I paste the path to "grpc-petstore.proto" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test insomnia-petstore.json
    When I paste the path to "insomnia-petstore.json" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test postman-petstore.json
    When I paste the path to "postman-petstore.json" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test soap-docker.wsdl
    When I paste the path to "soap-docker.wsdl" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results
    # Test soap-petstore.wsdl
    When I paste the path to "soap-petstore.wsdl" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results

  Scenario: Import requests and search
    When I click the import button
    And I paste "http://localhost:8080/api/swagger.json" in the source input
    Then I should see import preview results
    When I click the Import button in the modal
    Then the import modal should be closed
    And I should see new items in the sidebar
    When I open the search bar
    And I search for "pet"
    Then I should see search results
    And the first result should contain "pet"
    When I click on the first search result
    Then a tab containing "pet" should be open
    When I click the import button again
    Then the import modal should be open
    And the destination dropdown should show the root node
    And the destination dropdown should show all imported folders

