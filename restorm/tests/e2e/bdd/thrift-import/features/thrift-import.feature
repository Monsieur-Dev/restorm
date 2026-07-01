Feature: Thrift IDL import — documentation-only entries

  Apache Thrift services speak their own binary wire protocol, so v1 import is
  documentation-only: services and their methods become browsable sidebar
  entries with no executable request behind them, backed by structured docs
  (models from structs, enum definitions from includes).

  Scenario: Import a .thrift file builds a documentation-only folder tree
    Given a new single-file YAML collection for Thrift import
    When I import the Thrift fixture file "petstore.thrift"
    Then the sidebar should show the imported folder "com.example.petstore"
    And the sidebar should show the imported folder "PetService"

  Scenario: Re-import is idempotent
    Given a new single-file YAML collection for Thrift import
    When I import the Thrift fixture file "petstore.thrift"
    And I import the Thrift fixture file "petstore.thrift"
    Then exactly 1 folder named "com.example.petstore" should be in the sidebar

  Scenario: Auto-detection picks Thrift from pasted IDL content
    Given a new single-file YAML collection for Thrift import
    When I paste the Thrift fixture file "petstore.thrift" into the import source
    Then the import preview should be visible
