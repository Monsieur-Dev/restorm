Feature: Import Requests
  As a user, I want to import requests from various sources
  so that I can quickly add collections to my workspace.

  Background:
    Given I have started the application
    And system modals mocking is installed
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

  # TODO: Fix this test - preview not showing on successive imports
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
    # Test swagger-petstore.json
    When I paste the path to "swagger-petstore.json" in the source input
    Then I should see import preview results
    When I clear the source input
    Then I should not see import preview results

  # TEMPORARILY DISABLED - OYO-157
  # This scenario times out reliably at the `destination-dropdown-button`
  # click after a search-result tab has been opened, because per-request
  # markdown documentation (which used to seed the search index) is now
  # empty during Phase 2 and timing shifts in the import → index → render
  # sequence expose a pre-existing flake on that button under full-suite
  # load (the scenario still passes in isolation). It will be restored
  # in Phase 5 once the compiler (Phase 3) re-produces per-request docs.

  Scenario: Import to root and open request
    When I click the import button
    And I paste "http://localhost:8080/api/swagger.json" in the source input
    Then I should see import preview results
    When I click the Import button in the modal
    Then the import modal should be closed
    And I should see new items in the sidebar
    When I expand the "Swagger Petstore" folder
    And I expand the "pet" folder
    And I click on the "Find pet by ID" request
    Then the request tab should be open

