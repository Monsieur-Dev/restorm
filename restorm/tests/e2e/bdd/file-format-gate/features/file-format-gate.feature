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

  Scenario: A project that declares no version at its root is refused
    # The root is the ONE read site. A document carrying its version anywhere
    # else declares nothing there — and a document Restorm wrote always
    # declares one, so "none" means it came from somewhere else.
    Given a project written by this build
    And its file format version sits where an earlier build wrote it

    When I open that project
    Then the incompatible-project message is shown
    And no project is open
    And the project file on disk is unchanged

  Scenario: A version at the position an earlier build used is not consulted at all
    # Not even to refuse on: a value out of range there changes nothing,
    # because the root — which declares nothing — already decided.
    Given a project written by this build
    And its file format version sits where an earlier build wrote it
    And its file format version is raised beyond what this build supports

    When I open that project
    Then the incompatible-project message is shown
    And no project is open
    And the project file on disk is unchanged

  Scenario: A project without a design keeps the base format on save
    # The version a save writes is derived from the content — the lazy
    # bump. A project using no version-gated feature saves at format 1
    # and stays openable by every build.
    Given a project written by this build
    When I open that project
    Then that project is open
    When I edit the notes of the env folder "Redis Playground" and save
    Then the project file on disk declares file format version "1"

  Scenario: A project carrying a design opens, saves at the design format, and reopens intact
    # 1.1 is what makes a build that predates designs refuse the file
    # cleanly (the refusal scenarios above); for THIS build it is an
    # ordinary supported version, and a save carries it forward.
    Given a project carrying an API design
    When I open that project
    Then the incompatible-project message is not shown
    And that project is open
    When I edit the notes of the env folder "Petstore design project" and save
    Then the project file on disk declares file format version "1.1"
    And the project file on disk still carries the design
    When I close and reopen that project
    Then that project is open
    And the project file on disk still carries the design

