Feature: Refusing a project written by a newer build
  A project file carries the version of the on-disk format it was written
  in. A build that meets a higher version than it understands cannot read
  the file correctly, and loading it anyway would mean a partial read
  followed by a save that overwrites whatever it failed to understand.

  So the app refuses, says why, and leaves the file exactly as it found it.

  The version is read from ONE place: the document root. A value anywhere
  else is not a version, it is leftover text — including a value that
  looks newer.

  Scenario: A project at the current format version opens normally
    Given a project written by this build
    When I open that project
    Then the incompatible-project message is not shown
    And that project is open
    And the project file on disk is unchanged

  Scenario: A project from a newer format version is refused, not loaded
    Given a project written by this build
    And its file format version is raised beyond what this build supports

    When I open that project
    Then the incompatible-project message is shown
    And no project is open
    And the project file on disk is unchanged

    When I dismiss the incompatible-project message
    Then the incompatible-project message is gone
    And the app is still usable

  Scenario: A project carrying the version where an earlier build wrote it still opens
    Given a project written by this build
    And its file format version sits where an earlier build wrote it

    When I open that project
    Then the incompatible-project message is not shown
    And that project is open
    And the project file on disk is unchanged

  Scenario: A version at the position an earlier build used is not consulted at all
    Given a project written by this build
    And its file format version sits where an earlier build wrote it
    And its file format version is raised beyond what this build supports

    When I open that project
    Then the incompatible-project message is not shown
    And that project is open
    And the project file on disk is unchanged

  Scenario: A folder project whose root index declares a newer format is refused
    Given a folder-mode project written by this build
    And its root index declares a format version beyond what this build supports

    When I open that project
    Then the incompatible-project message is shown
    And no project is open
    And the project file on disk is unchanged
