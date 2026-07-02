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

  Scenario: Re-import creates a separate copy
    # Import has no merge/dedup step (by design — each import is an
    # independent onboarding action), so importing the same source
    # twice lands two sibling folders rather than reconciling into one.
    Given a new single-file YAML collection for Thrift import
    When I import the Thrift fixture file "petstore.thrift"
    And I import the Thrift fixture file "petstore.thrift"
    Then exactly 2 folders named "com.example.petstore" should be in the sidebar

  Scenario: Auto-detection picks Thrift without an explicit format choice
    Given a new single-file YAML collection for Thrift import
    When I provide the Thrift fixture file "petstore.thrift" as the import source
    Then the import preview should be visible
