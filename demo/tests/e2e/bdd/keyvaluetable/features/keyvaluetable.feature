Feature: KeyValueTable

  Scenario: Edit key/value/description cells (wrapping InputBox)
    Given I open the key value table tab
    Then key value table "keyvaluetable-basic" should be visible
    When I set key value table "keyvaluetable-basic" row "row-1" key to "foo2"
    When I set key value table "keyvaluetable-basic" row "row-1" value to "bar2"
    When I set key value table "keyvaluetable-basic" row "row-1" description to "desc2"
    Then key value table last rows should contain "\"id\": \"row-1\""
    Then key value table last rows should contain "\"key\": \"foo2\""
    Then key value table last rows should contain "\"value\": \"bar2\""
    Then key value table last rows should contain "\"description\": \"desc2\""

  Scenario: Toggle enabled and delete a row
    Given I open the key value table tab
    When I toggle key value table "keyvaluetable-basic" row "row-2" enabled
    Then key value table last rows should contain "\"id\": \"row-2\""
    When I delete key value table "keyvaluetable-basic" row "row-2"
    Then key value table last rows should not contain "\"id\": \"row-2\""

