Feature: Refusing a project written by a newer build
  A project file carries the version of the on-disk format it was written
  in. A build that meets a higher version than it understands cannot read
  the file correctly, and loading it anyway would mean a partial read
  followed by a save that overwrites whatever it failed to understand.

  So the app refuses, says why, and leaves the file exactly as it found it.

  Scenario: A project at the current format version opens normally
    Given a project written by this build
    When I open that project
    Then the incompatible-project message is not shown
    And that project is open

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
