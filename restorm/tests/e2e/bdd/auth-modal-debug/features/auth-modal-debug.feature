Feature: Auth setup modal overflow debug
  Temporary diagnostic test — opens the import flow, triggers the
  auth setup modal, shrinks the window so the modal becomes short,
  and captures a screenshot plus bounding-box diagnostics so layout
  regressions can be inspected visually.

  Scenario: Auth setup modal does not overflow at small window heights
    Given a new single-file YAML collection for auth debug
    When I open the import modal and click Add authentication route
    And I shrink the window to 900x500
    Then the auth setup modal content fits inside the modal frame
