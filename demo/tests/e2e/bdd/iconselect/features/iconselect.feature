Feature: IconSelect

  Scenario: Open and close picker
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    Then icon select "iconselect-basic" should be open
    When I close icon select "iconselect-basic"
    Then icon select "iconselect-basic" should be closed

  Scenario: Disabled icon select does not open
    Given I open the icon select e2e tab
    Then icon select "iconselect-disabled" should be closed

  Scenario: Readonly icon select stays closed
    Given I open the icon select e2e tab
    Then icon select "iconselect-readonly" should be closed
    Then icon select "iconselect-readonly" should be readonly

  Scenario: Select emoji
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "emoji"
    When I type in icon select "iconselect-basic" search for tab "emoji" "people"
    When I select first emoji in icon select "iconselect-basic"
    Then icon select harness selected type should be "emoji"
    Then icon select harness selected value should not be empty

  Scenario: Select codicon
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "codicon"
    When I type in icon select "iconselect-basic" search for tab "codicon" "fold"
    When I select first icon of type "codicon" in icon select "iconselect-basic"
    Then icon select harness selected type should be "codicon"
    Then icon select harness selected value should not be empty

  Scenario: Select iconoir icon
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "iconoir"
    When I type in icon select "iconselect-basic" search for tab "iconoir" "a"
    When I select first icon of type "iconoir" in icon select "iconselect-basic"
    Then icon select harness selected type should be "iconoir"
    Then icon select harness selected value should not be empty

  Scenario: Select phosphor icon
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "phosphor"
    When I type in icon select "iconselect-basic" search for tab "phosphor" "ph"
    When I select first icon of type "phosphor" in icon select "iconselect-basic"
    Then icon select harness selected type should be "phosphor"
    Then icon select harness selected value should not be empty

  Scenario: Select material icon
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "material"
    When I type in icon select "iconselect-basic" search for tab "material" "mdi"
    When I select first icon of type "material" in icon select "iconselect-basic"
    Then icon select harness selected type should be "material"
    Then icon select harness selected value should not be empty

  Scenario: Select simpleicons icon
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "simpleicons"
    When I type in icon select "iconselect-basic" search for tab "simpleicons" "si"
    When I select first icon of type "simpleicons" in icon select "iconselect-basic"
    Then icon select harness selected type should be "simpleicons"
    Then icon select harness selected value should not be empty

  Scenario: Select feather icon
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "feather"
    When I type in icon select "iconselect-basic" search for tab "feather" "fea"
    When I select first icon of type "feather" in icon select "iconselect-basic"
    Then icon select harness selected type should be "feather"
    Then icon select harness selected value should not be empty

  Scenario: Select fontawesome icon
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "fontawesome"
    When I type in icon select "iconselect-basic" search for tab "fontawesome" "fa"
    When I select first icon of type "fontawesome" in icon select "iconselect-basic"
    Then icon select harness selected type should be "fontawesome"
    Then icon select harness selected value should not be empty

  Scenario: Clear selection
    Given I open the icon select e2e tab
    When I open icon select "iconselect-basic"
    When I select icon select "iconselect-basic" tab "codicon"
    When I type in icon select "iconselect-basic" search for tab "codicon" "fold"
    When I select first icon of type "codicon" in icon select "iconselect-basic"
    When I open icon select "iconselect-basic"
    When I clear icon select "iconselect-basic"
    Then icon select harness selected type should be ""
    Then icon select harness selected value should be ""

