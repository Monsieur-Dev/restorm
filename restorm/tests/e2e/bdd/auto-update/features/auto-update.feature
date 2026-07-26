Feature: Silent auto-update — manual check surfaces the result
  The auto-update engine checks in the background and on a manual trigger.
  With the update mock reporting "no update available", a manual check must
  end with the "you're up to date" notification — proving the mock engine,
  the IPC bridge, the state broadcast, and the toast wiring all connect
  end-to-end without a real release feed.

  Scenario: A manual check with no update available shows the up-to-date toast
    Given the app is running with the update mock
    When I trigger a manual update check
    Then the "up to date" update notification appears
