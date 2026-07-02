Feature: gRPC reflection import — discover a live server's services without a .proto file

  Extends the gRPC execution suite: instead of a .proto file, the user points
  Restorm at a running server's host:port and Restorm queries
  grpc.reflection.v1alpha.ServerReflection to discover the same call surface.

  Background:
    Given I launch a dedicated restorm MCP instance for gRPC reflection import
    And I open a fresh project via MCP

  Scenario: Import via reflection against grpcbin, then run a discovered method
    When I open the Import dialog and switch to the gRPC reflection card
    And I connect to "localhost:9000" via gRPC reflection
    Then the sidebar should contain an environment folder named "grpcbin"
    When I open the imported "DummyUnary" request and invoke it
    Then the gRPC response shows a non-error status
