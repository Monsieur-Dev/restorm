Feature: VariableInputBox

  Scenario: Type in a specific variable input box and observe last change
    Given I open the variable input box tab
    When I type in variable input box "variableinputbox-basic" "Hello {{foo}} xyz"
    Then variable input box last change should contain "Hello {{foo}} xyz"

  Scenario: disableDefaultProviders is exposed and no-providers instance still updates value
    Given I open the variable input box tab
    When I type in variable input box "variableinputbox-no-providers" "Hello {{foo}} xyz"
    Then variable input box last change should contain "Hello {{foo}} xyz"

  Scenario: Custom context menu item triggers a harness action
    Given I open the variable input box tab
    When I right click variable input box "variableinputbox-custom-menu"
    Then variable input box last context action should contain ""
    When I click variable input box context menu item "Custom action"
    Then variable input box last context action should contain "custom-action"

  Scenario: F3 / Shift+F3 do not open Monaco's find widget
    # VariableInputBox is a single-line input — Monaco's find-next /
    # find-prev widgets have no meaningful target and would leak UI into
    # the host. The component registers no-op handlers for those keys.
    Given I open the variable input box tab
    When I press "F3" in variable input box "variableinputbox-basic"
    Then no Monaco find widget should be visible
    When I press "Shift+F3" in variable input box "variableinputbox-basic"
    Then no Monaco find widget should be visible

