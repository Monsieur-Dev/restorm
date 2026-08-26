Feature: API Designer property panel is reachable via the GUI

  The property panel must render its fields and let the user switch between
  the "Property" and "Code generation" tabs — driven purely by clicks.

  Scenario: The property panel exposes its fields and both tabs
    Given restorm is launched blank for GUI design work
    When I create a design and add a model with a property named "latitude"
    Then the property fields are visible
    And switching to the code-generation tab hides the property fields
    And switching back to the property tab shows the property fields again
