Feature: Documentation Compilation
  As a user importing an API specification, I want the documentation to be
  compiled on the fly from the structured ApiDocumentation stored on the root
  folder so that the Docs tab shows meaningful content for every route.

  Background:
    Given I have started the application
    And system modals mocking is installed
    And I have created a new empty file

  Scenario Outline: Import <format> spec and see the root Docs tab populated
    When I click the import button
    And I paste the path to "<file>" in the source input
    Then I should see import preview results
    When I click the Import button in the modal
    Then the import modal should be closed
    And I should see new items in the sidebar
    When I select the imported root folder
    Then the folder Docs tab should be populated with compiled markdown

    Examples:
      | format    | file                     |
      | Swagger   | swagger-petstore.json    |
      | SOAP      | soap-petstore.wsdl       |
      | gRPC      | grpc-petstore.proto      |
      | GraphQL   | graphql-petstore.graphql |
      | AsyncAPI  | asyncapi-petstore.yaml   |
      | Postman   | postman-petstore.json    |
      | Insomnia  | insomnia-petstore.json   |
      | Bruno     | bruno-petstore.json      |
