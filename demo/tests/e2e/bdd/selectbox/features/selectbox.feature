Feature: SelectBox

  Scenario: Open and close (click outside)
    Given I open the select box e2e tab
    Then select box "selectbox-basic" should be visible
    When I open select box "selectbox-basic"
    Then select box "selectbox-basic" should be open
    When I close select box "selectbox-basic"
    Then select box "selectbox-basic" should be closed

  Scenario: Click selection closes and updates harness
    Given I open the select box e2e tab
    When I open select box "selectbox-basic"
    When I select option with label "Gamma" in select box "selectbox-basic"
    Then select box "selectbox-basic" selected index should be 2
    Then select box "selectbox-basic" selected label should be "Gamma"
    Then select box harness last selected id should be "selectbox-basic"
    Then select box harness last selected index should be 2
    Then select box harness last selected text should be "Gamma"

  Scenario: Keyboard navigation skips disabled options
    Given I open the select box e2e tab
    When I press "Enter" in select box "selectbox-with-disabled"
    Then select box "selectbox-with-disabled" should be open
    Then select box "selectbox-with-disabled" option with label "Disabled 1" should be disabled
    When I press "ArrowDown" in select box "selectbox-with-disabled"
    When I press "ArrowDown" in select box "selectbox-with-disabled"
    When I press "Enter" in select box "selectbox-with-disabled"
    Then select box harness last selected id should be "selectbox-with-disabled"
    Then select box harness last selected index should be 2
    Then select box harness last selected text should be "Enabled 2"
    Then select box "selectbox-with-disabled" selected label should be "Enabled 2"

  Scenario: Details pane updates with selection
    Given I open the select box e2e tab
    When I open select box "selectbox-with-details"
    When I select option with label "Theme B" in select box "selectbox-with-details"
    When I open select box "selectbox-with-details"
    Then select box "selectbox-with-details" details should contain "Theme B"
    Then select box "selectbox-with-details" details should contain "Description for Theme B"

  Scenario: Long list scroll and select
    Given I open the select box e2e tab
    When I open select box "selectbox-long"
    Then scrollable element "selectbox-long-scrollable" should be visible
    When I wheel scroll scrollable element "selectbox-long-scrollable" vertically by 600
    Then scrollable element "selectbox-long-scrollable" scroll top should be >= 100
    When I select option 30 in select box "selectbox-long"
    Then select box harness last selected id should be "selectbox-long"
    Then select box harness last selected index should be 30
    Then select box harness last selected text should be "Option 30"

