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
    # grpcbin's reflection surface spans several DIFFERENT proto packages
    # (addsvc, examplepb, grpcbin, hello) bundled into one demo binary, so
    # the top-level env folder gets the generic "no single package" fallback
    # name rather than "grpcbin" — asserting on the discovered service
    # folder instead proves reflection actually found GRPCBin.
    Then the sidebar should contain an environment folder named "grpcbin.GRPCBin"
    When I open the imported "DummyUnary" request and invoke it
    Then the gRPC response shows a non-error status
