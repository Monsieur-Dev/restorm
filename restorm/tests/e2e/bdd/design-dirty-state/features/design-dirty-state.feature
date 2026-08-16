Feature: Design edits ride the standard dirty and autosave pipeline
  A design inserts into the SAME pipeline requests and folders use —
  reactive proxy, document events, save units — with no parallel
  mechanism. So an edit marks the window dirty immediately, a save
  cleans it, autosave persists it, and the edit survives a reopen.

  Until the Design tab ships, edits go through the app's design
  mutation helper — the exact assignment path the tab will use.

  Scenario: A design edit marks the window dirty, a save cleans it, the edit survives a reopen
    Given a project carrying an API design is open
    Then the window is clean
    When I set the design notes to "designed dirty"
    Then the window is dirty
    When I save all
    Then the window is clean
    And the project file on disk contains "designed dirty"
    When I close and reopen that project
    Then the design notes read "designed dirty"

  Scenario: Every design section marks the window dirty
    # Parameterized over EVERY top-level design section: a section whose
    # edits reach no event would look applied on screen and be lost on
    # close — this scenario forbids a silent surface.
    Given a project carrying an API design is open
    Then editing each design section marks the window dirty and saving cleans it

  Scenario: Autosave persists a design edit without a manual save
    Given a project carrying an API design is open
    And autosave is enabled with a short delay
    When I set the design notes to "autosaved design"
    Then the project file on disk eventually contains "autosaved design"
