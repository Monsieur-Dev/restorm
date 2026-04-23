Feature: OData request tab — typing reflects in the visible input
  Regression for OYO-253: typing into $filter / $select / $top etc.
  used to mutate the reactive proxy but skipped React state, so the
  displayed input stayed empty even though the data was persisted on
  save. The inputs now hold their own local state and keep the proxy
  in sync on every keystroke.

  Scenario: Typing a filter expression shows up in the $filter input
    Given I open the OData typing sample collection
    And I open the request "List People" in an OData tab

    When I type "Name eq 'Alice'" into the $filter input
    Then the $filter input should show "Name eq 'Alice'"
    And the OData URL preview should contain "$filter=Name%20eq%20'Alice'"

    When I type "42" into the $top input
    Then the $top input should show "42"
    And the OData URL preview should contain "$top=42"

    When I type "Id, Name" into the $select input
    Then the $select input should show "Id, Name"
    And the OData URL preview should contain "$select=Id%2CName"

    When I type "puppy" into the $search input
    Then the $search input should show "puppy"
    And the OData URL preview should contain "$search=puppy"
