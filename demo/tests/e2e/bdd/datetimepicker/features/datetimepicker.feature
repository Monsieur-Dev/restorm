Feature: DateTimePicker

  Scenario: Open and close popover
    Given I open the datetime picker e2e tab
    Then date time picker "datetimepicker-basic" should be visible
    When I open date time picker "datetimepicker-basic"
    Then date time picker "datetimepicker-basic" should be open
    Then tooltip "datetimepicker-basic-popover" should be visible
    Then tooltip "datetimepicker-basic-popover" data-placement should be "below"
    When I close date time picker "datetimepicker-basic"
    Then date time picker "datetimepicker-basic" should be closed
    Then tooltip "datetimepicker-basic-popover" should be hidden

  Scenario: Select a day updates selection state
    Given I open the datetime picker e2e tab
    When I open date time picker "datetimepicker-basic"
    When I set date time picker "datetimepicker-basic" output mode to "iso"
    When I select day "2024-01-20" in date time picker "datetimepicker-basic"
    Then date time picker "datetimepicker-basic" should be closed
    When I open date time picker "datetimepicker-basic"
    Then date time picker "datetimepicker-basic" day "2024-01-20" should be selected
    When I close date time picker "datetimepicker-basic"

  Scenario: Include time can be toggled and time updated
    Given I open the datetime picker e2e tab
    When I open date time picker "datetimepicker-basic"
    When I set date time picker "datetimepicker-basic" output mode to "iso"
    When I set date time picker "datetimepicker-basic" include time to "true"
    When I set date time picker "datetimepicker-basic" hours to 9
    When I set date time picker "datetimepicker-basic" minutes to 5
    When I set date time picker "datetimepicker-basic" include time to "false"
    When I close date time picker "datetimepicker-basic"

  Scenario: Output mode and pattern editing updates preview (VariableInputBox)
    Given I open the datetime picker e2e tab
    When I open date time picker "datetimepicker-basic"
    When I set date time picker "datetimepicker-basic" output mode to "pattern"
    Then date time picker "datetimepicker-basic" output mode should be "pattern"
    Then datetime picker preview value should not be empty
    Then I remember datetime picker preview value
    When I focus variable input box "datetimepicker-basic-pattern"
    When I press "Control+A" in variable input box "datetimepicker-basic-pattern"
    When I press "Backspace" in variable input box "datetimepicker-basic-pattern"
    When I type in variable input box "datetimepicker-basic-pattern" "yyyy/MM/dd"
    Then datetime picker preview value should be different from remembered
    When I set date time picker "datetimepicker-basic" output mode to "iso"
    Then date time picker "datetimepicker-basic" output mode should be "iso"
    When I close date time picker "datetimepicker-basic"

