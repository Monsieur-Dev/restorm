Feature: RadioGroup

  Scenario: Clicking an item changes the selection and logs it
    Given I open the radio tab
    Then radio group "radio-basic" should be visible
    Then radio group "radio-basic" item 0 should be checked
    When I click radio group "radio-basic" item 2
    Then radio group "radio-basic" item 2 should be checked
    Then radio last select should contain "\"testId\":\"radio-basic\""
    Then radio last select should contain "\"index\":2"
    Then radio select count should be 1

  Scenario: Disabled item does not change selection
    Given I open the radio tab
    Then radio group "radio-with-disabled" should be visible
    Then radio group "radio-with-disabled" item 1 should be disabled
    Then radio group "radio-with-disabled" item 0 should be checked
    Then radio select count should be 0
    When I click radio group "radio-with-disabled" item 1
    Then radio group "radio-with-disabled" item 0 should be checked
    Then radio select count should be 0

  Scenario: Tooltip is exposed via title attribute
    Given I open the radio tab
    Then radio group "radio-with-tooltips" should be visible
    Then radio group "radio-with-tooltips" item 0 title should be "This is option A"

