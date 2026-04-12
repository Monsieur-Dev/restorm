Feature: Window position and size persistence
  As a user, I want my window position and size to be remembered
  when I close and reopen the application.

  Scenario: Window position and size are restored after restart
    Given a fresh app with cleared settings
    When I move and resize the window to x=1310 y=10 width=600 height=600
    And I close the app
    And I relaunch the app without clearing settings
    Then the window bounds should be x=1310 y=10 width=600 height=600
    When I close the app and read saved bounds
    Then the saved bounds should be x=1310 y=10 width=600 height=600
