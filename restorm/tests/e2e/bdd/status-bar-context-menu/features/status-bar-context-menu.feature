Feature: Status bar file-path actions
  Activating the status bar cell that shows the open .restorm file's path
  opens a statusbar popover with 3 actions: reveal the file in the OS file
  explorer, copy the file name, and copy the full path. Each action closes
  the popover once it has fired.

  Scenario: The popover shows the 3 expected actions and reveals the file in the OS explorer
    Given a new single-file YAML collection named "statusbar-menu-reveal"
    When I activate the status bar file-path cell
    Then the status bar path popover shows exactly 3 actions: reveal in folder, copy file name, copy full path
    When I click "Open containing folder" in the status bar path popover
    Then the OS file explorer was asked to reveal the open file's path
    And the status bar path popover is closed

  Scenario: Copy file name writes only the basename to the clipboard
    Given a new single-file YAML collection named "statusbar-menu-copy-name"
    When I activate the status bar file-path cell
    And I click "Copy file name" in the status bar path popover
    Then the clipboard holds only the open file's name
    And the status bar path popover is closed

  Scenario: Copy full path writes the absolute path to the clipboard
    Given a new single-file YAML collection named "statusbar-menu-copy-path"
    When I activate the status bar file-path cell
    And I click "Copy full path" in the status bar path popover
    Then the clipboard holds the open file's full path
    And the status bar path popover is closed

  Scenario: No file open means no status bar cell and nothing to activate
    Given the app is freshly launched with no project open
    Then the status bar file-path cell is absent

  Scenario: The reveal channel refuses every path that is not the open project
    Given a new single-file YAML collection named "statusbar-menu-guard"
    Then the reveal channel refuses "/etc/hostname"
    And the reveal channel refuses "../../../etc/hostname"
    And the reveal channel refuses "relative-name.restorm"
    And the reveal channel refuses ""
    And the OS file explorer was never called

  Scenario: The reveal channel refuses every path when no project is open
    Given the app is freshly launched with no project open
    Then the reveal channel refuses "/etc/hostname"
    And the reveal channel refuses ""
    And the OS file explorer was never called
