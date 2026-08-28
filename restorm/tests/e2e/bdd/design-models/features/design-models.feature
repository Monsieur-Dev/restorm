Feature: Design models and enums editor
  The Models section is a master-details editor: property table with a
  click-to-edit panel, named examples with seeded auto values, settings
  (identifier, volumetry, lifecycle, inheritance) and the "Used by"
  jump list. The Enums section reuses the custom-value-lists editor.
  Validation errors surface on the row AND in the sidebar.

  Scenario: Create a complete model with typed, flagged, constrained properties
    Given a Pro project carrying an API design is open in the models editor
    When I add a model
    And I add a property named "sku"
    And I toggle the property flag "required"
    And I toggle the property flag "pii"
    And I toggle the property flag "searchable"
    And I set the property min length to "3"
    And I save the project
    Then the saved file carries a model "NewModel" whose property "sku" is required, PII, searchable, with min length 3
    When I close the design tab and reopen the design on the models section
    And I open the model "NewModel"
    Then the property row "sku" shows the flags "required, PII, searchable"

  Scenario: A model relation is a reference-typed property with a delete rule
    Given a Pro project carrying an API design is open in the models editor
    When I open the model "Order"
    Then the property row "customer" shows the type "model → User"
    When I select the property row "customer"
    And I set the reference delete rule to "Supprimer en cascade"
    And I open the model "User" settings tab
    Then the used-by list contains "Order.customer"
    When I click the used-by entry "Order.customer"
    Then the model card shows "Order"

  Scenario: Inheritance shows parent properties read-only and refuses cycles
    Given a Pro project carrying an API design is open in the models editor
    When I open the model "AdminUser"
    Then the inherited property row "email" is read-only with a jump to the parent
    When I click the jump on the inherited row "email"
    Then the model card shows "User"
    When I open the model "User" settings tab
    Then the inheritance choices do not offer "AdminUser"

  Scenario: Validation errors surface on the row and in the sidebar, and clear on fix
    Given a Pro project carrying an API design is open in the models editor
    When I open the model "Order"
    And I add a property named ""
    Then the models sidebar entry carries an error dot
    When I rename the selected property to "customer"
    Then the selected property panel reports a duplicate-name issue
    When I rename the selected property to "trackingCode"
    Then the models sidebar entry carries no error dot

  Scenario: Deleting a parent model lists the impacted children first
    Given a Pro project carrying an API design is open in the models editor
    When I open the model "User"
    And I ask to delete the model
    Then the delete modal lists the child "AdminUser"
    When I confirm the model deletion
    Then the models list does not offer "User"
    When I open the model "AdminUser"
    Then the property row "scope" shows the type "string"
    And the model card has no inherited rows

  Scenario: An enum created in the Enums section types a property
    Given a Pro project carrying an API design is open in the models editor
    When I open the enums section
    And I add an enum
    And I add the enum value "gold"
    And I open the models section
    And I open the model "Order"
    And I add a property named "tier"
    And I set the property type to "NewEnum (enum)"
    Then the property row "tier" shows the type "enum → NewEnum"

  Scenario: A model's operational profile is set from the settings tab and persists
    Given a Pro project carrying an API design is open in the models editor
    When I open the model "User" settings tab
    And I set the model profile "design-model-access-pattern" to "Lecture dominante"
    And I set the model profile "design-model-sensitivity" to "Données personnelles (PII)"
    And I open the model "Order"
    And I open the model "User" settings tab
    Then the model profile "design-model-access-pattern" shows "Lecture dominante"
    And the model profile "design-model-sensitivity" shows "Données personnelles (PII)"

  Scenario: Named examples refuse constraint-violating values and seed the rest
    Given a Pro project carrying an API design is open in the models editor
    When I open the model "User" examples tab
    And I add a named example
    Then the example value row "id" is tagged "auto"
    When I type "short" as the example value of "password"
    Then the example value input of "password" reports a constraint violation
    And the example value row "password" is tagged "auto"
    When I type "correct-horse-battery" as the example value of "password"
    Then the example value row "password" is tagged "defined"
