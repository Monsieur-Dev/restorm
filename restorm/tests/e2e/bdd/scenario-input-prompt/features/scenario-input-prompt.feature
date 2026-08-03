Feature: The run-parameters modal's answer is the value the run uses

  A scenario's `input` node declares `petId` and feeds a "pet by id" request whose
  URL is `{{baseUrl}}/pet/{{petId}}`. Running the scenario raises the run-parameters
  modal; the value the user picks there must be the value the request dispatches.

  The fixture is deliberately THREE-WAY DISTINCT, one value per layer:

    | layer                          | value |
    | the request's own path param   | 1     |
    | the input node's typed default | 2     |
    | the answer given in the modal  | 3     |

  With only two distinct values the assertion could not tell which layer won — a
  run that ignores the answer and a run that honours it would look identical. Here
  the fetched pet names the winner: 1 means the request's own path param won, 2
  means the input's default won (the answer was discarded — the reported bug), and
  3 is correct. So each scenario asserts BOTH that the answer's pet was fetched AND
  that neither of the other two layers reached the wire.

  The expected value is fixed by the DESIGN of the fixture, not captured from what
  the app currently produces, and it is asserted in the step rather than in a
  regenerable golden — a golden regenerated on a red build would re-freeze the bug
  as the expectation.

  Every type is covered separately because they marshal differently: a string is a
  raw scalar, a number is coerced, and an enum and a custom-list each carry a
  reference (an enum definition id / a value-list id) that has to be resolved
  before the value can reach a URL.

  Scenario Outline: the modal's answer wins over the input default and the request's own path param
    Given I open the input-prompt sample
    When I run the "<scenario>" scenario and answer petId with "3"
    Then the run fetched pet 3, not the request's own 1 nor the input default 2

    Examples:
      | scenario           |
      | string prompt      |
      | number prompt      |
      | enum prompt        |
      | custom list prompt |
